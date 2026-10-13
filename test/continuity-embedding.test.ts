import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityEmbeddingService,
  ContinuityMemoryService,
  MemoryService,
  PersonaService,
  SqliteContinuityMemoryRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type ContinuityEmbeddingProvider,
  type EmbeddingRequest,
} from "../src/index.js";

class TopicEmbeddingProvider implements ContinuityEmbeddingProvider {
  public readonly identity = {
    provider: "test-provider",
    model: "topic-v1",
    dimensions: 3,
  } as const;

  public async embed(request: EmbeddingRequest): Promise<readonly number[]> {
    const text = request.text.toLocaleLowerCase();
    return [
      /automobile|car|vehicle/u.test(text) ? 1 : 0.01,
      /citrus|orange|fruit/u.test(text) ? 1 : 0.01,
      /meeting|schedule|calendar/u.test(text) ? 1 : 0.01,
    ];
  }
}

function fixture(
  provider: ContinuityEmbeddingProvider = new TopicEmbeddingProvider(),
) {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memories = new SqliteMemoryRepository(database);
  const repository = new SqliteContinuityMemoryRepository(database, memories);
  return {
    database,
    personas: new PersonaService(new SqlitePersonaRepository(database)),
    continuity: new ContinuityMemoryService(repository),
    embeddings: new ContinuityEmbeddingService(repository, provider),
    memoryService: new MemoryService(memories),
  };
}

test("hybrid retrieval finds semantic matches without lexical overlap", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const semantic = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "The user prefers traveling by automobile.",
      type: "preference",
    });
    const lexical = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "A car was mentioned in an unrelated note.",
      type: "fact",
    });
    await setup.embeddings.indexMemory(persona.persona.id, semantic.memory.id);

    const results = await setup.embeddings.retrieve({
      personaId: persona.persona.id,
      text: "car",
    });

    assert.equal(results[0]?.personaMemory.memory.id, semantic.memory.id);
    assert.ok((results[0]?.semanticScore ?? 0) > 0.99);
    assert.equal(
      results.find(
        ({ personaMemory }) => personaMemory.memory.id === lexical.memory.id,
      )?.lexicalScore,
      1,
    );
    assert.equal(results.length, 2);
  } finally {
    setup.database.close();
  }
});

test("hybrid retrieval preserves persona, sensitivity, policy, and time boundaries", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const skylar = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const advisor = setup.personas.createPersona({ userId: user.id, name: "Advisor" });
    const allowed = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "The user likes citrus snacks.",
      type: "preference",
    });
    const sensitive = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "Sensitive citrus preference.",
      type: "preference",
      sensitivity: "sensitive",
    });
    const excluded = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "Excluded citrus preference.",
      type: "preference",
      retrievalPolicy: "exclude",
    });
    const expired = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "episodic",
      assertion: "An expired citrus discussion.",
      type: "task_context",
      validTo: "2026-10-12T00:00:00Z",
    });
    const other = setup.continuity.create({
      personaId: advisor.persona.id,
      memoryClass: "durable",
      assertion: "The advisor remembers citrus.",
      type: "relationship",
    });
    for (const memory of [allowed, sensitive, excluded, expired]) {
      await setup.embeddings.indexMemory(skylar.persona.id, memory.memory.id);
    }
    await setup.embeddings.indexMemory(advisor.persona.id, other.memory.id);

    const results = await setup.embeddings.retrieve({
      personaId: skylar.persona.id,
      text: "orange fruit",
      asOf: "2026-10-13T00:00:00Z",
    });
    assert.deepEqual(
      results.map(({ personaMemory }) => personaMemory.memory.id),
      [allowed.memory.id],
    );
    for (const memory of [sensitive, excluded, expired, other]) {
      const row = setup.database
        .prepare("SELECT use_count FROM memory_items WHERE id = ?")
        .get(memory.memory.id) as { use_count: number };
      assert.equal(row.use_count, 0);
    }
  } finally {
    setup.database.close();
  }
});

test("indexing is persona-bound and revised memories cannot use stale embeddings", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const skylar = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const advisor = setup.personas.createPersona({ userId: user.id, name: "Advisor" });
    const memory = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "The user prefers an automobile.",
      type: "preference",
    });
    await assert.rejects(
      setup.embeddings.indexMemory(advisor.persona.id, memory.memory.id),
      /Persona memory not found for embedding/u,
    );
    await setup.embeddings.indexMemory(skylar.persona.id, memory.memory.id);
    setup.memoryService.revise(
      memory.memory.id,
      { assertion: "The preference is now walking." },
      { actor: "user", explicitUserAction: true },
    );

    const results = await setup.embeddings.retrieve({
      personaId: skylar.persona.id,
      text: "car",
    });
    assert.deepEqual(results, []);
    const rows = setup.database
      .prepare("SELECT memory_revision_id FROM memory_embeddings")
      .all() as Array<{ memory_revision_id: string }>;
    assert.deepEqual(rows, [{ memory_revision_id: memory.memory.revisionId }]);
  } finally {
    setup.database.close();
  }
});

test("provider output validation fails before derived data is stored or retrieved", async () => {
  const invalidProvider: ContinuityEmbeddingProvider = {
    identity: { provider: "broken", model: "bad", dimensions: 2 },
    embed: async () => [1, Number.NaN],
  };
  const setup = fixture(invalidProvider);
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const memory = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "Validation target.",
      type: "fact",
    });
    await assert.rejects(
      setup.embeddings.indexMemory(persona.persona.id, memory.memory.id),
      /finite numbers/u,
    );
    await assert.rejects(
      setup.embeddings.retrieve({ personaId: persona.persona.id, text: "target" }),
      /finite numbers/u,
    );
    const count = setup.database
      .prepare("SELECT count(*) AS count FROM memory_embeddings")
      .get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    setup.database.close();
  }
});

test("hybrid retrieval validates persona and query before calling a provider", async () => {
  let calls = 0;
  const provider: ContinuityEmbeddingProvider = {
    identity: { provider: "counting", model: "test", dimensions: 1 },
    embed: async () => {
      calls += 1;
      return [1];
    },
  };
  const setup = fixture(provider);
  try {
    await assert.rejects(
      setup.embeddings.retrieve({ personaId: "missing", text: "query" }),
      /Persona not found/u,
    );
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    await assert.rejects(
      setup.embeddings.retrieve({
        personaId: persona.persona.id,
        text: "query",
        candidateLimit: Number.NaN,
      }),
      /candidate limit/u,
    );
    assert.deepEqual(
      await setup.embeddings.retrieve({
        personaId: persona.persona.id,
        text: "query",
        memoryClasses: [],
      }),
      [],
    );
    assert.equal(calls, 0);
  } finally {
    setup.database.close();
  }
});
