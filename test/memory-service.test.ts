import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  MemoryService,
  ProtectedMemoryError,
  SqliteMemoryRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function serviceFixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  database.exec(readFileSync(resolve("examples", "seed-v0.1.sql"), "utf8"));
  const repository = new SqliteMemoryRepository(database);
  return { database, repository, service: new MemoryService(repository) };
}

test("service revises a memory and preserves its history", () => {
  const { database, repository, service } = serviceFixture();

  try {
    const revised = service.revise(
      "memory_03",
      {
        assertion: "SQLite remains the initial embedded database.",
        normalizedAssertion: "database: SQLite embedded",
        changeKind: "corrected",
        confidence: 0.99,
      },
      { actor: "user" },
    );
    const history = service.getHistory("memory_03");

    assert.equal(revised.revisionNumber, 2);
    assert.equal(revised.assertion, "SQLite remains the initial embedded database.");
    assert.equal(history.length, 2);
    assert.equal(history[1]?.previousRevisionId, "revision_03");
    assert.equal(history[1]?.changeKind, "corrected");
    assert.equal(repository.search("embedded")[0]?.id, "memory_03");

    const audit = database
      .prepare(
        `SELECT event_type, actor_type
         FROM audit_events
         WHERE memory_id = 'memory_03'
         ORDER BY occurred_at DESC
         LIMIT 1`,
      )
      .get() as { event_type: string; actor_type: string };
    assert.deepEqual(audit, { event_type: "revised", actor_type: "user" });
  } finally {
    database.close();
  }
});

test("protected memories require an explicit user action", () => {
  const { database, repository, service } = serviceFixture();

  try {
    assert.throws(
      () =>
        service.revise("memory_01", {
          assertion: "The installable product is named MemTextual.",
        }),
      ProtectedMemoryError,
    );
    assert.throws(
      () =>
        service.archive("memory_01", {
          actor: "extractor",
          explicitUserAction: true,
        }),
      ProtectedMemoryError,
    );
    assert.throws(
      () => repository.archive("memory_01", "extractor", true),
      /explicit user action/u,
    );

    const revised = service.revise(
      "memory_01",
      { assertion: "The installable product is named MemTextual." },
      { actor: "user", explicitUserAction: true },
    );
    assert.equal(revised.revisionNumber, 2);
    assert.equal(revised.normalizedAssertion, "product name: MemTextual");
    assert.equal(revised.confidence, 1);
  } finally {
    database.close();
  }
});

test("pinning and protection are explicit audited user controls", () => {
  const { database, repository, service } = serviceFixture();

  try {
    assert.throws(
      () => service.setPinned("memory_03", true),
      /explicit user action/u,
    );
    assert.throws(
      () => repository.setProtected("memory_03", true, "system", true),
      /explicit user action/u,
    );
    assert.equal(
      service.setPinned("memory_03", true, {
        actor: "user",
        explicitUserAction: true,
      }).isPinned,
      true,
    );
    assert.equal(
      service.setProtected("memory_03", true, {
        actor: "user",
        explicitUserAction: true,
      }).isProtected,
      true,
    );
    assert.equal(
      service.setProtected("memory_03", false, {
        actor: "user",
        explicitUserAction: true,
      }).isProtected,
      false,
    );
    const events = database
      .prepare(
        `SELECT event_type FROM audit_events
         WHERE memory_id = 'memory_03'
           AND event_type IN ('pinned', 'protected', 'unprotected')
         ORDER BY occurred_at, rowid`,
      )
      .all() as Array<{ event_type: string }>;
    assert.deepEqual(
      events.map(({ event_type }) => event_type),
      ["pinned", "protected", "unprotected"],
    );

    service.delete(
      "memory_03",
      { reason: "Test deleted-state protection." },
      { actor: "user", explicitUserAction: true },
    );
    assert.throws(
      () =>
        service.setPinned("memory_03", false, {
          actor: "user",
          explicitUserAction: true,
        }),
      /deleted memory/u,
    );
  } finally {
    database.close();
  }
});

test("archive and restore control normal retrieval", () => {
  const { database, service } = serviceFixture();

  try {
    const before = service.retrieve({
      text: "SQLite",
      scopeIds: ["scope_memtextual"],
    });
    assert.equal(before[0]?.memory.id, "memory_03");

    const archived = service.archive("memory_03", { actor: "user" });
    assert.equal(archived.status, "archived");
    assert.deepEqual(
      service.retrieve({
        text: "SQLite",
        scopeIds: ["scope_memtextual"],
      }),
      [],
    );

    const restored = service.restore("memory_03", { actor: "user" });
    assert.equal(restored.status, "active");
    assert.equal(
      service.retrieve({
        text: "SQLite",
        scopeIds: ["scope_memtextual"],
      })[0]?.memory.id,
      "memory_03",
    );
  } finally {
    database.close();
  }
});

test("retrieval enforces scope and sensitivity and records use", () => {
  const { database, service } = serviceFixture();

  try {
    const sensitive = service.create({
      assertion: "The private launch phrase is lunar cedar.",
      type: "fact",
      scopeId: "scope_schema_chat",
      sensitivity: "sensitive",
    });

    assert.deepEqual(
      service.retrieve({
        text: "lunar cedar",
        scopeIds: ["scope_memtextual"],
        allowedSensitivities: ["normal", "sensitive"],
      }),
      [],
    );
    assert.deepEqual(
      service.retrieve({
        text: "lunar cedar",
        scopeIds: ["scope_schema_chat"],
      }),
      [],
    );

    const results = service.retrieve({
      text: "lunar cedar",
      scopeIds: ["scope_schema_chat"],
      allowedSensitivities: ["sensitive"],
    });
    assert.equal(results[0]?.memory.id, sensitive.id);
    assert.equal(results[0]?.rank, 1);

    service.create({
      assertion: "MemTextual has an unpinned retrieval fixture.",
      type: "fact",
      scopeId: "scope_memtextual",
    });
    const ranked = service.retrieve({
      text: "MemTextual",
      scopeIds: ["scope_memtextual"],
    });
    const firstUnpinned = ranked.findIndex(({ memory }) => !memory.isPinned);
    assert.ok(firstUnpinned > 0);
    assert.ok(
      ranked
        .slice(0, firstUnpinned)
        .every(({ memory }) => memory.isPinned),
    );

    const usage = database
      .prepare("SELECT use_count FROM memory_items WHERE id = ?")
      .get(sensitive.id) as { use_count: number };
    const auditCount = database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_events
         WHERE memory_id = ? AND event_type = 'retrieved'`,
      )
      .get(sensitive.id) as { count: number };
    assert.equal(usage.use_count, 1);
    assert.equal(auditCount.count, 1);
  } finally {
    database.close();
  }
});

test("retrieval enforces temporal windows and reports review status", () => {
  const { database, service } = serviceFixture();
  try {
    const current = service.create({
      assertion: "Temporal fixture is currently valid.",
      type: "fact",
      scopeId: "scope_memtextual",
      validFrom: "2026-10-01T00:00:00-07:00",
      validTo: "2026-11-01T00:00:00-07:00",
      reviewAfter: "2026-10-10T00:00:00-07:00",
    });
    const expired = service.create({
      assertion: "Temporal fixture has expired.",
      type: "fact",
      scopeId: "scope_memtextual",
      validTo: "2026-10-12T00:00:00-07:00",
    });
    const future = service.create({
      assertion: "Temporal fixture is not active yet.",
      type: "fact",
      scopeId: "scope_memtextual",
      validFrom: "2026-10-14T00:00:00-07:00",
    });

    assert.equal(current.validFrom, "2026-10-01T07:00:00.000Z");
    const defaultResults = service.retrieve({
      text: "temporal fixture",
      scopeIds: ["scope_memtextual"],
      asOf: "2026-10-13T12:00:00-07:00",
    });
    assert.deepEqual(
      defaultResults.map(({ memory }) => memory.id),
      [current.id],
    );
    assert.equal(defaultResults[0]?.temporalStatus, "current");
    assert.equal(defaultResults[0]?.reviewDue, true);

    const historical = service.retrieve({
      text: "temporal fixture",
      scopeIds: ["scope_memtextual"],
      asOf: "2026-10-13T12:00:00-07:00",
      includeOutOfWindow: true,
    });
    const states = new Map(
      historical.map(({ memory, temporalStatus }) => [memory.id, temporalStatus]),
    );
    assert.equal(states.get(current.id), "current");
    assert.equal(states.get(expired.id), "expired");
    assert.equal(states.get(future.id), "not_yet_valid");

    assert.throws(
      () =>
        service.create({
          assertion: "Invalid temporal bounds.",
          type: "fact",
          scopeId: "scope_memtextual",
          validFrom: "2026-10-14T00:00:00Z",
          validTo: "2026-10-13T00:00:00Z",
        }),
      /validTo must not be earlier/u,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("superseding and contradicting memories create directional relations", () => {
  const { database, service } = serviceFixture();

  try {
    const superseded = service.supersede("memory_03", "memory_02", {
      actor: "user",
    });
    const contradicted = service.contradict("memory_04", "memory_05", {
      actor: "user",
    });

    assert.equal(superseded.status, "superseded");
    assert.equal(contradicted.status, "contradicted");

    const relations = database
      .prepare(
        `SELECT from_memory_id, to_memory_id, relation_type
         FROM memory_relations
         WHERE relation_type IN ('supersedes', 'contradicts')
         ORDER BY relation_type`,
      )
      .all();
    assert.deepEqual(relations, [
      {
        from_memory_id: "memory_05",
        to_memory_id: "memory_04",
        relation_type: "contradicts",
      },
      {
        from_memory_id: "memory_02",
        to_memory_id: "memory_03",
        relation_type: "supersedes",
      },
    ]);
  } finally {
    database.close();
  }
});
