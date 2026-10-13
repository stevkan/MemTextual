import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityEmbeddingService,
  ContinuityMemoryService,
  ContinuityRankingService,
  PersonaService,
  SqliteContinuityMemoryRepository,
  SqliteContinuityRankingRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type ContinuityEmbeddingProvider,
} from "../src/index.js";

const provider: ContinuityEmbeddingProvider = {
  identity: { provider: "ranking-test", model: "one", dimensions: 1 },
  embed: async () => [1],
};

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memories = new SqliteMemoryRepository(database);
  const continuityRepository = new SqliteContinuityMemoryRepository(
    database,
    memories,
  );
  const rankingRepository = new SqliteContinuityRankingRepository(database);
  return {
    database,
    personas: new PersonaService(new SqlitePersonaRepository(database)),
    continuity: new ContinuityMemoryService(continuityRepository),
    embeddings: new ContinuityEmbeddingService(continuityRepository, provider),
    ranking: new ContinuityRankingService(rankingRepository),
  };
}

test("personas receive independent default ranking profiles", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const first = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const second = setup.personas.createPersona({ userId: user.id, name: "Advisor" });

    for (const personaId of [first.persona.id, second.persona.id]) {
      const profile = setup.ranking.getProfile(personaId);
      assert.equal(profile.revisionNumber, 1);
      assert.equal(profile.lexicalWeight, 0.35);
      assert.equal(profile.semanticWeight, 0.65);
      assert.equal(profile.pinnedBoost, 0.15);
      assert.equal(profile.explicitBoost, 0.05);
      assert.equal(profile.emotionalWeight, 0);
      assert.equal(profile.createdBy, "system");
    }
    assert.notEqual(
      setup.ranking.getProfile(first.persona.id).id,
      setup.ranking.getProfile(second.persona.id).id,
    );
  } finally {
    setup.database.close();
  }
});

test("ranking changes require explicit user action and preserve immutable history", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const input = {
      personaId: persona.persona.id,
      expectedRevisionNumber: 1,
      episodicBoost: 0.4,
      note: "Favor recent shared episodes for this persona.",
    };

    assert.throws(() => setup.ranking.updateProfile(input), /explicit user action/u);
    const updated = setup.ranking.updateProfile(input, {
      actor: "user",
      explicitUserAction: true,
    });
    assert.equal(updated.revisionNumber, 2);
    assert.equal(updated.episodicBoost, 0.4);
    assert.equal(updated.createdBy, "user");
    assert.equal(setup.ranking.listProfileHistory(persona.persona.id).length, 2);
    assert.throws(
      () =>
        setup.ranking.updateProfile(input, {
          actor: "user",
          explicitUserAction: true,
        }),
      /changed from revision 1 to 2/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `UPDATE continuity_ranking_profiles
             SET episodic_boost = 0 WHERE persona_id = ? AND revision_number = 1`,
          )
          .run(persona.persona.id),
      /cannot be changed/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `DELETE FROM continuity_ranking_profiles
             WHERE persona_id = ? AND revision_number = 1`,
          )
          .run(persona.persona.id),
      /cannot be deleted/u,
    );
  } finally {
    setup.database.close();
  }
});

test("hybrid ranking applies the selected persona profile and explains its boost", async () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const durable = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "durable",
      assertion: "Car preference.",
      type: "preference",
    });
    const episodic = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "Car conversation.",
      type: "task_context",
    });
    await setup.embeddings.indexMemory(persona.persona.id, durable.memory.id);
    await setup.embeddings.indexMemory(persona.persona.id, episodic.memory.id);
    setup.ranking.updateProfile(
      {
        personaId: persona.persona.id,
        expectedRevisionNumber: 1,
        pinnedBoost: 0,
        explicitBoost: 0,
        episodicBoost: 0.4,
        durableBoost: 0,
      },
      { actor: "user", explicitUserAction: true },
    );

    const results = await setup.embeddings.retrieve({
      personaId: persona.persona.id,
      text: "car",
    });
    assert.equal(results[0]?.personaMemory.memory.id, episodic.memory.id);
    assert.equal(results[0]?.rankingBoost, 0.4);
    assert.equal(results[0]?.rankingProfileRevision, 2);
    assert.deepEqual(results[0]?.rankingSignals, {
      pinned: false,
      explicit: true,
      memoryClass: "episodic",
    });
    assert.equal(results[1]?.rankingBoost, 0);

    const audit = setup.database
      .prepare(
        `SELECT detail_json FROM audit_events
         WHERE memory_id = ? AND event_type = 'retrieved'
         ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(episodic.memory.id) as { detail_json: string };
    assert.equal(JSON.parse(audit.detail_json).rankingProfileRevision, 2);
  } finally {
    setup.database.close();
  }
});
