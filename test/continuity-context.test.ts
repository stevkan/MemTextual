import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityContextService,
  ContinuityLexicalContextService,
  ContinuityEmbeddingService,
  ContinuityMemoryService,
  PersonaService,
  SqliteContinuityMemoryRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type ContinuityEmbeddingProvider,
  type EmbeddingRequest,
} from "../src/index.js";

class ContextEmbeddingProvider implements ContinuityEmbeddingProvider {
  public readonly identity = {
    provider: "context-test",
    model: "topic-v1",
    dimensions: 2,
  } as const;

  public calls = 0;

  public async embed(request: EmbeddingRequest): Promise<readonly number[]> {
    this.calls += 1;
    const text = request.text.toLocaleLowerCase();
    return [/citrus|orange/u.test(text) ? 1 : 0.1, 0.1];
  }
}

function fixture(provider = new ContextEmbeddingProvider()) {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memories = new SqliteMemoryRepository(database);
  const repository = new SqliteContinuityMemoryRepository(database, memories);
  const embeddings = new ContinuityEmbeddingService(repository, provider);
  return {
    database,
    provider,
    personas: new PersonaService(new SqlitePersonaRepository(database)),
    continuity: new ContinuityMemoryService(repository),
    embeddings,
    contexts: new ContinuityContextService(embeddings),
  };
}

test("bounded context is structured memory data with an exact UTF-8 size", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const assertion = "The user likes citrus tea and the symbol 🍊.";
    const memory = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion,
      type: "preference",
    });
    await setup.embeddings.indexMemory(persona.persona.id, memory.memory.id);

    const composition = await setup.contexts.compose({
      personaId: persona.persona.id,
      text: "orange citrus",
      contextLimits: { maxItems: 1, maxUtf8Bytes: 2_048 },
    });

    assert.equal(composition.payload.contentRole, "memory_data");
    assert.equal(composition.payload.personaId, persona.persona.id);
    assert.equal(composition.payload.items[0]?.assertion, assertion);
    assert.deepEqual(JSON.parse(composition.contextJson), composition.payload);
    assert.equal(
      composition.utf8Bytes,
      Buffer.byteLength(composition.contextJson, "utf8"),
    );
    assert.ok(composition.utf8Bytes <= 2_048);
  } finally {
    setup.database.close();
  }
});

test("context limits skip whole memories and record only selected results", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const memories = [
      setup.continuity.create({
        personaId: persona.persona.id,
        memoryClass: "durable",
        assertion: "The user likes citrus tea.",
        type: "preference",
      }),
      setup.continuity.create({
        personaId: persona.persona.id,
        memoryClass: "episodic",
        assertion: "The user discussed an orange recipe.",
        type: "task_context",
      }),
    ];
    for (const memory of memories) {
      await setup.embeddings.indexMemory(persona.persona.id, memory.memory.id);
    }

    const composition = await setup.contexts.compose({
      personaId: persona.persona.id,
      text: "citrus orange",
      contextLimits: { maxItems: 1, maxUtf8Bytes: 2_048 },
    });
    assert.equal(composition.payload.items.length, 1);
    assert.equal(composition.omissionCounts.itemLimit, 1);
    const selectedId = composition.payload.items[0]?.memoryId;

    for (const memory of memories) {
      const row = setup.database
        .prepare("SELECT use_count FROM memory_items WHERE id = ?")
        .get(memory.memory.id) as { use_count: number };
      assert.equal(row.use_count, memory.memory.id === selectedId ? 1 : 0);
    }
    const audits = setup.database
      .prepare(
        `SELECT memory_id, detail_json
         FROM audit_events
         WHERE event_type = 'retrieved'`,
      )
      .all() as Array<{ memory_id: string; detail_json: string }>;
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.memory_id, selectedId);
    const detail = JSON.parse(audits[0]?.detail_json ?? "{}") as {
      contextComposition?: { itemCount: number; utf8Bytes: number };
    };
    assert.equal(detail.contextComposition?.itemCount, 1);
    assert.equal(detail.contextComposition?.utf8Bytes, composition.utf8Bytes);
  } finally {
    setup.database.close();
  }
});

test("byte and class limits omit memories without assertion truncation", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const episodic = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: `Citrus ${"🍊".repeat(600)}`,
      type: "task_context",
      isPinned: true,
    });
    const durable = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "The user prefers orange tea.",
      type: "preference",
    });
    for (const memory of [episodic, durable]) {
      await setup.embeddings.indexMemory(persona.persona.id, memory.memory.id);
    }

    const composition = await setup.contexts.compose({
      personaId: persona.persona.id,
      text: "citrus orange",
      contextLimits: {
        maxItems: 2,
        maxUtf8Bytes: 700,
        maxEpisodicItems: 1,
        maxDurableItems: 1,
      },
    });
    assert.deepEqual(
      composition.payload.items.map(({ memoryId }) => memoryId),
      [durable.memory.id],
    );
    assert.equal(composition.payload.items[0]?.assertion, durable.memory.assertion);
    assert.equal(composition.omissionCounts.byteLimit, 1);

    const classLimited = await setup.contexts.compose({
      personaId: persona.persona.id,
      text: "citrus orange",
      contextLimits: {
        maxItems: 2,
        maxUtf8Bytes: 4_096,
        maxEpisodicItems: 0,
        maxDurableItems: 1,
      },
    });
    assert.deepEqual(
      classLimited.payload.items.map(({ memoryId }) => memoryId),
      [durable.memory.id],
    );
    assert.equal(classLimited.omissionCounts.classLimit, 1);
  } finally {
    setup.database.close();
  }
});

test("invalid or impossible context limits fail before provider use", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    await assert.rejects(
      setup.contexts.compose({
        personaId: persona.persona.id,
        text: "citrus",
        contextLimits: { maxItems: 0 },
      }),
      /maxItems must be an integer/u,
    );
    await assert.rejects(
      setup.contexts.compose({
        personaId: persona.persona.id,
        text: "citrus",
        contextLimits: { maxUtf8Bytes: 1 },
      }),
      /too small for the Continuity context envelope/u,
    );
    assert.equal(setup.provider.calls, 0);
  } finally {
    setup.database.close();
  }
});

test("ordinary hybrid retrieval still records every returned result", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const memories = ["Citrus tea preference.", "Orange recipe note."].map(
      (assertion) =>
        setup.continuity.create({
          personaId: persona.persona.id,
          memoryClass: "durable",
          assertion,
          type: "fact",
        }),
    );
    for (const memory of memories) {
      await setup.embeddings.indexMemory(persona.persona.id, memory.memory.id);
    }

    const results = await setup.embeddings.retrieve({
      personaId: persona.persona.id,
      text: "citrus orange",
    });
    assert.equal(results.length, 2);
    for (const result of results) {
      const row = setup.database
        .prepare("SELECT use_count FROM memory_items WHERE id = ?")
        .get(result.personaMemory.memory.id) as { use_count: number };
      assert.equal(row.use_count, 1);
    }
  } finally {
    setup.database.close();
  }
});

test("lexical context needs no embedding provider and records only included memories", async () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  try {
    const memories = new SqliteMemoryRepository(database);
    const repository = new SqliteContinuityMemoryRepository(database, memories);
    const personas = new PersonaService(new SqlitePersonaRepository(database));
    const continuity = new ContinuityMemoryService(repository);
    const contexts = new ContinuityLexicalContextService(repository);
    const user = personas.createUser({ displayName: "Steve" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const created = [
      continuity.create({
        personaId: persona.persona.id,
        memoryClass: "durable",
        assertion: "The user prefers citrus tea.",
        type: "preference",
      }),
      continuity.create({
        personaId: persona.persona.id,
        memoryClass: "episodic",
        assertion: "The user discussed citrus recipes.",
        type: "task_context",
      }),
    ];

    const composition = await contexts.compose({
      personaId: persona.persona.id,
      text: "citrus",
      contextLimits: { maxItems: 1, maxUtf8Bytes: 2_048 },
    });

    assert.equal(composition.payload.items.length, 1);
    assert.equal(composition.omissionCounts.itemLimit, 1);
    const selectedId = composition.payload.items[0]?.memoryId;
    for (const memory of created) {
      const usage = database
        .prepare("SELECT use_count FROM memory_items WHERE id = ?")
        .get(memory.memory.id) as { use_count: number };
      assert.equal(usage.use_count, memory.memory.id === selectedId ? 1 : 0);
    }
    const detail = JSON.parse(
      (
        database
          .prepare(
            `SELECT detail_json FROM audit_events
             WHERE memory_id = ? AND event_type = 'retrieved'`,
          )
          .get(selectedId) as { detail_json: string }
      ).detail_json,
    ) as Record<string, unknown>;
    assert.equal(detail.retrievalMode, "lexical");
    assert.deepEqual(detail.contextComposition, {
      formatVersion: 1,
      utf8Bytes: composition.utf8Bytes,
      itemCount: 1,
      maxUtf8Bytes: 2_048,
      maxItems: 1,
    });

    await assert.rejects(
      contexts.compose({
        personaId: persona.persona.id,
        text: "citrus",
        candidateLimit: 20,
      }),
      /Lexical context does not accept hybrid/u,
    );
  } finally {
    database.close();
  }
});
