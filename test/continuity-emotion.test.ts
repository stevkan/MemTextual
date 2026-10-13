import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityEmbeddingService,
  ContinuityEmotionService,
  ContinuityMemoryService,
  ContinuityRankingService,
  MemoryService,
  PersonaService,
  SqliteContinuityEmotionRepository,
  SqliteContinuityMemoryRepository,
  SqliteContinuityRankingRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type ContinuityEmbeddingProvider,
} from "../src/index.js";

const provider: ContinuityEmbeddingProvider = {
  identity: { provider: "emotion-test", model: "one", dimensions: 1 },
  embed: async () => [1],
};

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const continuityRepository = new SqliteContinuityMemoryRepository(
    database,
    memoryRepository,
  );
  return {
    database,
    personas: new PersonaService(new SqlitePersonaRepository(database)),
    continuity: new ContinuityMemoryService(continuityRepository),
    embeddings: new ContinuityEmbeddingService(continuityRepository, provider),
    emotions: new ContinuityEmotionService(
      new SqliteContinuityEmotionRepository(database),
    ),
    ranking: new ContinuityRankingService(
      new SqliteContinuityRankingRepository(database),
    ),
    memories: new MemoryService(memoryRepository),
  };
}

test("emotional annotations require explicit user action and preserve history", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const other = setup.personas.createPersona({ userId: user.id, name: "Advisor" });
    const memory = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "A meaningful shared success.",
      type: "relationship",
    });
    const input = {
      personaId: persona.persona.id,
      memoryId: memory.memory.id,
      expectedProfileRevision: 0,
      valence: 0.8,
      activation: 0.6,
      salience: 0.9,
      note: "User-marked emotional context.",
    };

    assert.throws(() => setup.emotions.annotate(input), /explicit user action/u);
    assert.throws(
      () => setup.emotions.getProfile(other.persona.id, memory.memory.id),
      /Persona memory not found/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO continuity_emotional_profiles (
               id, memory_revision_id, persona_id, revision_number,
               valence, activation, salience, created_by
             ) VALUES ('cross-persona', ?, ?, 1, 0, 0.5, 0.5, 'user')`,
          )
          .run(memory.memory.revisionId, other.persona.id),
      /current persona-memory revision/u,
    );
    const first = setup.emotions.annotate(input, {
      actor: "user",
      explicitUserAction: true,
    });
    const second = setup.emotions.annotate(
      {
        ...input,
        expectedProfileRevision: 1,
        activation: 0.4,
      },
      { actor: "user", explicitUserAction: true },
    );
    assert.equal(first.revisionNumber, 1);
    assert.equal(second.revisionNumber, 2);
    assert.equal(second.activation, 0.4);
    assert.equal(
      setup.emotions.listHistory(persona.persona.id, memory.memory.id).length,
      2,
    );
    assert.throws(
      () =>
        setup.emotions.annotate(input, {
          actor: "user",
          explicitUserAction: true,
        }),
      /changed from revision 0 to 2/u,
    );
    assert.throws(
      () =>
        setup.emotions.annotate(
          { ...input, expectedProfileRevision: 2, valence: 2 },
          { actor: "user", explicitUserAction: true },
        ),
      /valence must be between -1 and 1/u,
    );
  } finally {
    setup.database.close();
  }
});

test("emotional relevance is opt-in, explainable, and omits raw context from audits", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const positive = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "A bright milestone.",
      type: "relationship",
    });
    const negative = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "A difficult setback.",
      type: "relationship",
    });
    for (const memory of [positive, negative]) {
      await setup.embeddings.indexMemory(persona.persona.id, memory.memory.id);
    }
    setup.emotions.annotate(
      {
        personaId: persona.persona.id,
        memoryId: positive.memory.id,
        expectedProfileRevision: 0,
        valence: 1,
        activation: 0.8,
        salience: 1,
      },
      { actor: "user", explicitUserAction: true },
    );
    setup.emotions.annotate(
      {
        personaId: persona.persona.id,
        memoryId: negative.memory.id,
        expectedProfileRevision: 0,
        valence: -1,
        activation: 0.8,
        salience: 1,
      },
      { actor: "user", explicitUserAction: true },
    );
    setup.ranking.updateProfile(
      {
        personaId: persona.persona.id,
        expectedRevisionNumber: 1,
        pinnedBoost: 0,
        explicitBoost: 0,
        episodicBoost: 0,
        emotionalWeight: 0.5,
      },
      { actor: "user", explicitUserAction: true },
    );

    const results = await setup.embeddings.retrieve({
      personaId: persona.persona.id,
      text: "experience",
      emotionalContext: { valence: 1, activation: 0.8, salience: 1 },
    });
    assert.equal(results[0]?.personaMemory.memory.id, positive.memory.id);
    assert.equal(results[0]?.emotionalScore, 1);
    assert.equal(results[0]?.emotionalProfileRevision, 1);
    assert.equal(results[1]?.emotionalScore, 0);

    const audit = setup.database
      .prepare(
        `SELECT detail_json FROM audit_events
         WHERE memory_id = ? AND event_type = 'retrieved'
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(positive.memory.id) as { detail_json: string };
    const detail = JSON.parse(audit.detail_json) as Record<string, unknown>;
    assert.equal(detail.emotionalContextApplied, true);
    assert.equal(detail.emotionalProfileRevision, 1);
    assert.equal(detail.valence, undefined);
    assert.equal(detail.activation, undefined);
    assert.equal(detail.salience, undefined);
  } finally {
    setup.database.close();
  }
});

test("memory revisions cannot reuse stale emotional annotations", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const memory = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "Original emotional context.",
      type: "relationship",
    });
    setup.emotions.annotate(
      {
        personaId: persona.persona.id,
        memoryId: memory.memory.id,
        expectedProfileRevision: 0,
        valence: -0.5,
        activation: 0.7,
        salience: 0.8,
      },
      { actor: "user", explicitUserAction: true },
    );
    setup.memories.revise(
      memory.memory.id,
      { assertion: "Revised emotional context." },
      { actor: "user", explicitUserAction: true },
    );

    assert.equal(
      setup.emotions.getProfile(persona.persona.id, memory.memory.id),
      null,
    );
    assert.equal(
      setup.emotions.listHistory(persona.persona.id, memory.memory.id).length,
      1,
    );
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM continuity_emotional_profiles")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    setup.database.close();
  }
});

test("memory purge removes emotional annotations and accounts for them", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const memory = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "Emotion profile to purge.",
      type: "other",
    });
    setup.emotions.annotate(
      {
        personaId: persona.persona.id,
        memoryId: memory.memory.id,
        expectedProfileRevision: 0,
        valence: 0,
        activation: 0.5,
        salience: 0.5,
      },
      { actor: "user", explicitUserAction: true },
    );
    const context = { actor: "user" as const, explicitUserAction: true };
    setup.memories.delete(
      memory.memory.id,
      { reason: "User requested deletion." },
      context,
    );
    assert.notEqual(
      setup.emotions.getProfile(persona.persona.id, memory.memory.id),
      null,
    );
    assert.throws(
      () =>
        setup.emotions.annotate(
          {
            personaId: persona.persona.id,
            memoryId: memory.memory.id,
            expectedProfileRevision: 1,
            valence: 0,
            activation: 0,
            salience: 0,
          },
          context,
        ),
      /Deleted memory cannot receive emotional annotations/u,
    );
    const receipt = setup.memories.purge(
      memory.memory.id,
      {
        reason: "User requested permanent removal.",
        confirmation: memory.memory.id,
      },
      context,
    );
    assert.equal(receipt.deletedRowCounts.continuityEmotionalProfiles, 1);
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM continuity_emotional_profiles")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    setup.database.close();
  }
});
