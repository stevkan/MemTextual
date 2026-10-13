import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  openMemTextualDatabase,
  SqliteMemoryRepository,
} from "../src/index.js";

function seededDatabase() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  database.exec(readFileSync(resolve("examples", "seed-v0.1.sql"), "utf8"));
  return database;
}

test("migration and seed preserve schema integrity", () => {
  const database = seededDatabase();

  try {
    const memoryCount = database
      .prepare("SELECT count(*) AS count FROM memory_items")
      .get() as { count: number };
    const migrationCount = database
      .prepare("SELECT count(*) AS count FROM schema_migrations")
      .get() as { count: number };
    const violations = database.prepare("PRAGMA foreign_key_check").all();

    assert.equal(memoryCount.count, 10);
    assert.equal(migrationCount.count, 5);
    assert.deepEqual(violations, []);
  } finally {
    database.close();
  }
});

test("repository retrieves and safely searches current memories", () => {
  const database = seededDatabase();

  try {
    const repository = new SqliteMemoryRepository(database);
    const memory = repository.getById("memory_03");
    const results = repository.search("SQLite");

    assert.equal(memory?.assertion, "SQLite is the initial local database.");
    assert.equal(memory?.scopes[0]?.name, "MemTextual");
    assert.ok(results.some(({ id }) => id === "memory_03"));
    assert.deepEqual(repository.search("!!!"), []);
  } finally {
    database.close();
  }
});

test("repository creates a fully linked memory transactionally", () => {
  const database = seededDatabase();

  try {
    const repository = new SqliteMemoryRepository(database);
    const memory = repository.create({
      assertion: "TypeScript is the implementation language for MemTextual.",
      normalizedAssertion: "implementation language: TypeScript",
      type: "decision",
      scopeId: "scope_memtextual",
      sourceRecordId: "record_01",
      confidence: 1,
      createdBy: "user",
      isPinned: true,
    });

    assert.equal(memory.status, "active");
    assert.equal(memory.revisionNumber, 1);
    assert.equal(memory.scopes[0]?.isPrimary, true);
    assert.equal(repository.search("TypeScript")[0]?.id, memory.id);

    const evidenceCount = database
      .prepare(
        "SELECT count(*) AS count FROM memory_evidence WHERE memory_revision_id = ?",
      )
      .get(memory.revisionId) as { count: number };
    assert.equal(evidenceCount.count, 1);
  } finally {
    database.close();
  }
});

test("database rejects a current revision owned by another memory", () => {
  const database = seededDatabase();

  try {
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE memory_items SET current_revision_id = ? WHERE id = ?",
          )
          .run("revision_02", "memory_01"),
      /current revision must belong to memory item/u,
    );
  } finally {
    database.close();
  }
});

test("review automation migration upgrades an existing candidate database", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-migrate-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  copyFileSync(resolve("migrations", "001_initial.sql"), join(oldMigrations, "001_initial.sql"));
  copyFileSync(
    resolve("migrations", "002_ingestion_candidates.sql"),
    join(oldMigrations, "002_ingestion_candidates.sql"),
  );

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    oldDatabase
      .prepare(
        `INSERT INTO scopes (id, scope_kind, name)
         VALUES ('scope_upgrade', 'project', 'Upgrade test')`,
      )
      .run();
    oldDatabase
      .prepare(
        `INSERT INTO memory_candidates (
           id, memory_type, assertion, scope_id, proposed_by
         ) VALUES (
           'candidate_upgrade', 'fact', 'Preserve this candidate.',
           'scope_upgrade', 'system'
         )`,
      )
      .run();
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const candidate = upgraded
        .prepare(
          `SELECT assertion, proposer_id, external_id
           FROM memory_candidates WHERE id = 'candidate_upgrade'`,
        )
        .get() as {
          assertion: string;
          proposer_id: string | null;
          external_id: string | null;
        };
      const policyTable = upgraded
        .prepare(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'review_policies'`,
        )
        .get() as { present: 1 } | undefined;
      const migration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 3")
        .get() as { name: string };
      const legacyMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 4")
        .get() as { name: string };
      const resolutionMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 5")
        .get() as { name: string };

      assert.equal(candidate.assertion, "Preserve this candidate.");
      assert.equal(candidate.proposer_id, null);
      assert.equal(candidate.external_id, null);
      assert.deepEqual(policyTable, { present: 1 });
      assert.equal(migration.name, "candidate_review_automation_v0.7");
      assert.equal(legacyMigration.name, "legacy_memory_migration_v0.8");
      assert.equal(resolutionMigration.name, "candidate_resolution_v0.9");
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT 1 AS present FROM sqlite_master
             WHERE type = 'table' AND name = 'candidate_resolutions'`,
          )
          .get(),
        { present: 1 },
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("candidate resolution migration backfills completed reviews", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-resolution-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const repository = new SqliteMemoryRepository(oldDatabase);
    const scope = repository.createScope({ kind: "project", name: "Backfill" });
    const memory = repository.create({
      assertion: "Accepted memory.",
      type: "fact",
      scopeId: scope.id,
    });
    oldDatabase
      .prepare(
        `INSERT INTO memory_candidates (
           id, memory_type, assertion, scope_id, proposed_by, status,
           reviewed_by, reviewed_at, accepted_memory_id, review_note
         ) VALUES
           ('accepted_candidate', 'fact', 'Accepted memory.', ?, 'system',
            'accepted', 'user', '2026-10-12T00:00:00.000Z', ?, 'Accepted.'),
           ('rejected_candidate', 'fact', 'Ignored memory.', ?, 'system',
            'rejected', 'user', '2026-10-12T00:01:00.000Z', NULL, 'Ignored.')`,
      )
      .run(scope.id, memory.id, scope.id);
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const resolutions = upgraded
        .prepare(
          `SELECT candidate_id, outcome, result_memory_id
           FROM candidate_resolutions ORDER BY candidate_id`,
        )
        .all() as Array<{
        candidate_id: string;
        outcome: string;
        result_memory_id: string | null;
      }>;
      assert.deepEqual(resolutions, [
        {
          candidate_id: "accepted_candidate",
          outcome: "create",
          result_memory_id: memory.id,
        },
        {
          candidate_id: "rejected_candidate",
          outcome: "ignore",
          result_memory_id: null,
        },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
