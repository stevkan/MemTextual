import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityMemoryService,
  MemoryService,
  PersonaService,
  SqliteContinuityMemoryRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type PersonaMemoryClass,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memories = new SqliteMemoryRepository(database);
  const personas = new PersonaService(new SqlitePersonaRepository(database));
  const continuity = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memories),
  );
  return {
    database,
    personas,
    continuity,
    memoryService: new MemoryService(memories),
  };
}

test("episodic and durable memories remain bound to separate persona relationships", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const skylar = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const advisor = setup.personas.createPersona({ userId: user.id, name: "Advisor" });
    const durable = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "The user prefers concise answers.",
      type: "preference",
    });
    const episode = setup.continuity.create({
      personaId: advisor.persona.id,
      memoryClass: "episodic",
      assertion: "The user discussed a planning concern today.",
      type: "task_context",
      observedAt: "2026-10-13T12:00:00.000Z",
    });

    assert.equal(durable.memoryClass, "durable");
    assert.equal(episode.memoryClass, "episodic");
    assert.equal(durable.memory.scopes[0]?.id, skylar.relationship.scopeId);
    assert.equal(episode.memory.scopes[0]?.id, advisor.relationship.scopeId);
    assert.notEqual(durable.relationshipId, episode.relationshipId);
    assert.deepEqual(
      setup.continuity
        .listForPersona(skylar.persona.id, "durable")
        .map(({ memory }) => memory.id),
      [durable.memory.id],
    );
    assert.deepEqual(
      setup.continuity.listForPersona(skylar.persona.id, "episodic"),
      [],
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("profiled memories reject cross-persona scope changes", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const first = setup.personas.createPersona({ userId: user.id, name: "First" });
    const second = setup.personas.createPersona({ userId: user.id, name: "Second" });
    const memory = setup.continuity.create({
      personaId: first.persona.id,
      memoryClass: "durable",
      assertion: "Keep this inside the first relationship.",
      type: "relationship",
    });
    const unprofiled = setup.memoryService.create({
      assertion: "Unprofiled developer memory.",
      type: "fact",
      scopeId: second.relationship.scopeId,
    });

    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO memory_scopes (memory_id, scope_id, is_primary)
             VALUES (?, ?, 0)`,
          )
          .run(memory.memory.id, second.relationship.scopeId),
      /cannot cross relationship scopes/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("UPDATE memory_scopes SET memory_id = ? WHERE memory_id = ?")
          .run(unprofiled.id, memory.memory.id),
      /binding cannot be reassigned/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("UPDATE memory_scopes SET is_primary = 0 WHERE memory_id = ?")
          .run(memory.memory.id),
      /must remain primary/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("UPDATE memory_scopes SET scope_id = ? WHERE memory_id = ?")
          .run(second.relationship.scopeId, memory.memory.id),
      /cannot cross relationship scopes/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("DELETE FROM memory_scopes WHERE memory_id = ?")
          .run(memory.memory.id),
      /must retain its relationship scope/u,
    );
  } finally {
    setup.database.close();
  }
});

test("invalid persona memory requests are atomic", () => {
  const setup = fixture();
  try {
    const before = (
      setup.database.prepare("SELECT count(*) AS count FROM memory_items").get() as {
        count: number;
      }
    ).count;
    assert.throws(
      () =>
        setup.continuity.create({
          personaId: "missing-persona",
          memoryClass: "durable",
          assertion: "This must not be stored.",
          type: "fact",
        }),
      /Persona not found/u,
    );
    assert.throws(
      () =>
        setup.continuity.create({
          personaId: "missing-persona",
          memoryClass: "temporary" as PersonaMemoryClass,
          assertion: "This must also not be stored.",
          type: "fact",
        }),
      /Unsupported persona memory class/u,
    );
    const after = (
      setup.database.prepare("SELECT count(*) AS count FROM memory_items").get() as {
        count: number;
      }
    ).count;
    assert.equal(after, before);
  } finally {
    setup.database.close();
  }
});

test("memory purge removes its Continuity profile and reports it", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const profile = setup.continuity.create({
      personaId: persona.persona.id,
      memoryClass: "episodic",
      assertion: "A private episode to forget.",
      type: "other",
    });
    const explicitUserAction = { actor: "user" as const, explicitUserAction: true };
    setup.memoryService.delete(
      profile.memory.id,
      { reason: "User requested deletion." },
      explicitUserAction,
    );
    const receipt = setup.memoryService.purge(
      profile.memory.id,
      {
        reason: "User requested permanent removal.",
        confirmation: profile.memory.id,
      },
      explicitUserAction,
    );

    assert.equal(receipt.deletedRowCounts.continuityMemoryProfiles, 1);
    assert.equal(setup.continuity.getById(profile.memory.id), null);
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("persona-aware retrieval excludes other personas and unprofiled memories", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const skylar = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    const advisor = setup.personas.createPersona({ userId: user.id, name: "Advisor" });
    const durable = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "Oranges are a durable preference.",
      type: "preference",
    });
    const episode = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "episodic",
      assertion: "Oranges were discussed this morning.",
      type: "task_context",
    });
    const sensitive = setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "Oranges appear in a sensitive preference.",
      type: "preference",
      sensitivity: "sensitive",
    });
    setup.continuity.create({
      personaId: skylar.persona.id,
      memoryClass: "durable",
      assertion: "Oranges are excluded from automatic retrieval.",
      type: "preference",
      retrievalPolicy: "exclude",
    });
    const otherPersona = setup.continuity.create({
      personaId: advisor.persona.id,
      memoryClass: "durable",
      assertion: "Oranges belong to the advisor relationship.",
      type: "relationship",
    });
    const unprofiled = setup.memoryService.create({
      assertion: "Oranges in an unprofiled developer memory.",
      type: "fact",
      scopeId: skylar.relationship.scopeId,
    });

    const normal = setup.continuity.retrieve({
      personaId: skylar.persona.id,
      text: "oranges",
    });
    assert.deepEqual(
      normal.map(({ personaMemory }) => personaMemory.memory.id).sort(),
      [durable.memory.id, episode.memory.id].sort(),
    );
    assert.ok(
      normal.every(
        ({ personaMemory }) => personaMemory.personaId === skylar.persona.id,
      ),
    );

    const durableOnly = setup.continuity.retrieve({
      personaId: skylar.persona.id,
      text: "oranges",
      memoryClasses: ["durable"],
    });
    assert.deepEqual(
      durableOnly.map(({ personaMemory }) => personaMemory.memory.id),
      [durable.memory.id],
    );
    const withSensitive = setup.continuity.retrieve({
      personaId: skylar.persona.id,
      text: "oranges",
      allowedSensitivities: ["normal", "sensitive"],
    });
    assert.ok(
      withSensitive.some(
        ({ personaMemory }) => personaMemory.memory.id === sensitive.memory.id,
      ),
    );

    for (const id of [otherPersona.memory.id, unprofiled.id]) {
      const row = setup.database
        .prepare("SELECT use_count FROM memory_items WHERE id = ?")
        .get(id) as { use_count: number };
      assert.equal(row.use_count, 0);
      const auditCount = setup.database
        .prepare(
          `SELECT count(*) AS count FROM audit_events
           WHERE memory_id = ? AND event_type = 'retrieved'`,
        )
        .get(id) as { count: number };
      assert.equal(auditCount.count, 0);
    }
    const detail = setup.database
      .prepare(
        `SELECT detail_json FROM audit_events
         WHERE memory_id = ? AND event_type = 'retrieved'
         ORDER BY occurred_at LIMIT 1`,
      )
      .get(durable.memory.id) as { detail_json: string };
    assert.deepEqual(JSON.parse(detail.detail_json), {
      query: "oranges",
      personaId: skylar.persona.id,
      relationshipId: skylar.relationship.id,
      memoryClasses: ["episodic", "durable"],
    });
  } finally {
    setup.database.close();
  }
});

test("persona-aware retrieval fails closed for unknown personas and empty filters", () => {
  const setup = fixture();
  try {
    assert.throws(
      () =>
        setup.continuity.retrieve({
          personaId: "unknown-persona",
          text: "anything",
        }),
      /Persona not found/u,
    );
    const user = setup.personas.createUser({ displayName: "Steve" });
    const persona = setup.personas.createPersona({ userId: user.id, name: "Skylar" });
    assert.deepEqual(
      setup.continuity.retrieve({
        personaId: persona.persona.id,
        text: "anything",
        memoryClasses: [],
      }),
      [],
    );
    assert.deepEqual(
      setup.continuity.retrieve({
        personaId: persona.persona.id,
        text: "!!!",
      }),
      [],
    );
    assert.throws(
      () =>
        setup.continuity.retrieve({
          personaId: persona.persona.id,
          text: "anything",
          limit: Number.NaN,
        }),
      /finite number/u,
    );
  } finally {
    setup.database.close();
  }
});
