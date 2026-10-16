import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  continuityConversationTurnEventKind,
  IngestionService,
  openMemTextualDatabase,
  PersonaService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
} from "../src/index.js";

function seededDatabase() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  database.exec(readFileSync(resolve("examples", "seed-v0.1.sql"), "utf8"));
  return database;
}

function insertLegacyMemory(
  database: Database.Database,
  input: {
    memoryId: string;
    revisionId: string;
    scopeId: string;
    assertion: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO memory_items (id, memory_type)
       VALUES (?, 'fact')`,
    )
    .run(input.memoryId);
  database
    .prepare(
      `INSERT INTO memory_revisions (
         id, memory_id, revision_number, assertion, explicitness,
         confidence, change_kind, created_by
       ) VALUES (?, ?, 1, ?, 'explicit', 1, 'created', 'user')`,
    )
    .run(input.revisionId, input.memoryId, input.assertion);
  database
    .prepare(
      `UPDATE memory_items SET current_revision_id = ? WHERE id = ?`,
    )
    .run(input.revisionId, input.memoryId);
  database
    .prepare(
      `INSERT INTO memory_scopes (memory_id, scope_id, is_primary)
       VALUES (?, ?, 1)`,
    )
    .run(input.memoryId, input.scopeId);
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
    assert.equal(migrationCount.count, 20);
    assert.deepEqual(violations, []);
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO memory_candidates (
               id, memory_type, assertion, scope_id, proposed_by,
               valid_from, valid_to
             ) VALUES (
               'invalid-temporal-candidate', 'fact', 'Invalid window.',
               'scope_memtextual', 'system',
               '2026-10-14T00:00:00.000Z', '2026-10-13T00:00:00.000Z'
             )`,
          )
          .run(),
      /Candidate temporal bounds are invalid/,
    );
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

test("ambient capture migration upgrades schema 10 without changing existing data", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-ambient-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-10.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const memoryRepository = new SqliteMemoryRepository(oldDatabase);
    const ingestion = new IngestionService(
      new SqliteIngestionRepository(oldDatabase, memoryRepository),
    );
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Existing persona" });
    const imported = ingestion.importSource({
      kind: "chat",
      title: "Existing source",
      records: [{ kind: "message", content: "Existing evidence" }],
    });
    const candidateId = "schema-10-candidate";
    oldDatabase
      .prepare(
        `INSERT INTO memory_candidates (
           id, memory_type, assertion, scope_id, proposed_by
         ) VALUES (?, 'fact', 'Existing candidate', ?, 'system')`,
      )
      .run(candidateId, persona.relationship.scopeId);
    oldDatabase
      .prepare(
        `INSERT INTO candidate_evidence (candidate_id, source_record_id)
         VALUES (?, ?)`,
      )
      .run(candidateId, imported.records[0]!.id);
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare("SELECT assertion, status FROM memory_candidates WHERE id = ?")
          .get(candidateId),
        { assertion: "Existing candidate", status: "pending" },
      );
      assert.equal(
        (
          upgraded
            .prepare("SELECT count(*) AS count FROM ambient_candidate_profiles")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 11").get(),
        { name: "ambient_candidate_capture_v0.9" },
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 12").get(),
        { name: "ambient_sensitivity_assessment_v0.9" },
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("ambient sensitivity migration preserves schema 11 candidates", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-sensitive-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-11.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const memoryRepository = new SqliteMemoryRepository(oldDatabase);
    const ingestionRepository = new SqliteIngestionRepository(
      oldDatabase,
      memoryRepository,
    );
    const ingestion = new IngestionService(ingestionRepository);
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const imported = ingestion.importSource({
      kind: "chat",
      title: "Existing ambient source",
      records: [{ kind: "message", content: "Existing ambient evidence" }],
    });
    const candidateId = "schema-11-candidate";
    oldDatabase
      .prepare(
        `INSERT INTO memory_candidates (
           id, memory_type, assertion, scope_id, proposed_by, proposer_id
         ) VALUES (
           ?, 'fact', 'Existing ambient candidate', ?, 'extractor',
           'existing.extractor'
         )`,
      )
      .run(candidateId, persona.relationship.scopeId);
    oldDatabase
      .prepare(
        `INSERT INTO candidate_evidence (candidate_id, source_record_id)
         VALUES (?, ?)`,
      )
      .run(candidateId, imported.records[0]!.id);
    oldDatabase
      .prepare(
        `INSERT INTO ambient_candidate_profiles (
           candidate_id, source_id, user_id, persona_id, relationship_id,
           memory_class, extractor_id, extractor_version
         ) VALUES (?, ?, ?, ?, ?, 'durable', 'existing.extractor', '1')`,
      )
      .run(
        candidateId,
        imported.source.id,
        user.id,
        persona.persona.id,
        persona.relationship.id,
      );
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT
               sensitivity_assessment_status AS status,
               declared_sensitivity AS declared,
               assessed_sensitivity AS assessed,
               sensitivity_reason_codes_json AS reasons
             FROM ambient_candidate_profiles WHERE candidate_id = ?`,
          )
          .get(candidateId),
        {
          status: "legacy_unassessed",
          declared: null,
          assessed: null,
          reasons: "[]",
        },
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 12").get(),
        { name: "ambient_sensitivity_assessment_v0.9" },
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("temporal relevance migration preserves schema 12 candidates", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-temporal-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-12.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
    "012_ambient_sensitivity.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    oldDatabase
      .prepare(
        `INSERT INTO scopes (id, scope_kind, name)
         VALUES ('temporal-upgrade-scope', 'project', 'Temporal upgrade')`,
      )
      .run();
    oldDatabase
      .prepare(
        `INSERT INTO memory_candidates (
           id, memory_type, assertion, scope_id, proposed_by, observed_at
         ) VALUES (
           'temporal-upgrade-candidate', 'fact', 'Preserve temporal candidate.',
           'temporal-upgrade-scope', 'system', '2026-10-01T00:00:00.000Z'
         )`,
      )
      .run();
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT assertion, observed_at, valid_from, valid_to, review_after
             FROM memory_candidates WHERE id = 'temporal-upgrade-candidate'`,
          )
          .get(),
        {
          assertion: "Preserve temporal candidate.",
          observed_at: "2026-10-01T00:00:00.000Z",
          valid_from: null,
          valid_to: null,
          review_after: null,
        },
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 13").get(),
        { name: "temporal_relevance_v0.9" },
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("authorized host capture migration preserves schema 13 memories", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-host-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-13.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
    "012_ambient_sensitivity.sql",
    "013_temporal_relevance.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const memory = new SqliteMemoryRepository(oldDatabase).create({
      assertion: "Preserve this pre-host-capture memory.",
      type: "fact",
      scopeId: persona.relationship.scopeId,
      createdBy: "user",
    });
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT assertion FROM memory_revisions
             WHERE id = (SELECT current_revision_id FROM memory_items WHERE id = ?)`,
          )
          .get(memory.id),
        { assertion: "Preserve this pre-host-capture memory." },
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 14").get(),
        { name: "authorized_host_capture_v0.9" },
      );
      assert.equal(
        (
          upgraded
            .prepare("SELECT count(*) AS count FROM continuity_host_authorizations")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.equal(
        (
          upgraded
            .prepare("SELECT count(*) AS count FROM continuity_host_events")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("persona ranking migration preserves schema 14 data and backfills defaults", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-ranking-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-14.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
    "012_ambient_sensitivity.sql",
    "013_temporal_relevance.sql",
    "014_authorized_host_capture.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const memory = new SqliteMemoryRepository(oldDatabase).create({
      assertion: "Preserve this memory during ranking migration.",
      type: "fact",
      scopeId: persona.relationship.scopeId,
      createdBy: "user",
    });
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT revision_number, lexical_weight, semantic_weight,
                    pinned_boost, explicit_boost, created_by
             FROM continuity_ranking_profiles WHERE persona_id = ?`,
          )
          .get(persona.persona.id),
        {
          revision_number: 1,
          lexical_weight: 0.35,
          semantic_weight: 0.65,
          pinned_boost: 0.15,
          explicit_boost: 0.05,
          created_by: "system",
        },
      );
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT assertion FROM memory_revisions
             WHERE id = (SELECT current_revision_id FROM memory_items WHERE id = ?)`,
          )
          .get(memory.id),
        { assertion: "Preserve this memory during ranking migration." },
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 15").get(),
        { name: "persona_ranking_v0.9" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("emotional relevance migration preserves schema 15 ranking profiles", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-emotion-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-15.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
    "012_ambient_sensitivity.sql",
    "013_temporal_relevance.sql",
    "014_authorized_host_capture.sql",
    "015_persona_ranking.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const originalProfile = oldDatabase
      .prepare(
        `SELECT id, lexical_weight, semantic_weight
         FROM continuity_ranking_profiles WHERE persona_id = ?`,
      )
      .get(persona.persona.id) as {
      id: string;
      lexical_weight: number;
      semantic_weight: number;
    };
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT id, lexical_weight, semantic_weight, emotional_weight
             FROM continuity_ranking_profiles WHERE persona_id = ?`,
          )
          .get(persona.persona.id),
        {
          ...originalProfile,
          emotional_weight: 0,
        },
      );
      assert.equal(
        (
          upgraded
            .prepare("SELECT count(*) AS count FROM continuity_emotional_profiles")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 16").get(),
        { name: "emotional_relevance_v0.9" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("conversation binding migration preserves schema 16 persona data", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-conversations-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-16.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
    "008_source_series_deletion_purge.sql",
    "009_persona_foundations.sql",
    "010_persona_memory_classes.sql",
    "011_ambient_capture.sql",
    "012_ambient_sensitivity.sql",
    "013_temporal_relevance.sql",
    "014_authorized_host_capture.sql",
    "015_persona_ranking.sql",
    "016_emotional_relevance.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    oldDatabase
      .prepare(
        `INSERT INTO continuity_host_authorizations (
           id, user_id, persona_id, relationship_id, host_id, grant_hash,
           allowed_event_kinds_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "authorization-existing",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "test.conversation-host",
        "a".repeat(64),
        JSON.stringify([continuityConversationTurnEventKind]),
      );
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT user_id, persona_id, relationship_id, host_id
             FROM continuity_host_authorizations WHERE id = ?`,
          )
          .get("authorization-existing"),
        {
          user_id: user.id,
          persona_id: persona.persona.id,
          relationship_id: persona.relationship.id,
          host_id: "test.conversation-host",
        },
      );
      assert.equal(
        (
          upgraded
            .prepare("SELECT count(*) AS count FROM continuity_conversations")
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 17").get(),
        { name: "continuity_conversations_v0.9" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("conversation capture recovery migration preserves schema 17 bindings", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-captures-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-17.db");
  mkdirSync(oldMigrations);
  for (let version = 1; version <= 17; version += 1) {
    const prefix = version.toString().padStart(3, "0");
    const filename = [
      "001_initial.sql",
      "002_ingestion_candidates.sql",
      "003_review_automation.sql",
      "004_legacy_memory_migration.sql",
      "005_candidate_resolution.sql",
      "006_source_versioning.sql",
      "007_memory_deletion_purge.sql",
      "008_source_series_deletion_purge.sql",
      "009_persona_foundations.sql",
      "010_persona_memory_classes.sql",
      "011_ambient_capture.sql",
      "012_ambient_sensitivity.sql",
      "013_temporal_relevance.sql",
      "014_authorized_host_capture.sql",
      "015_persona_ranking.sql",
      "016_emotional_relevance.sql",
      "017_continuity_conversations.sql",
    ].find((candidate) => candidate.startsWith(prefix));
    assert.ok(filename);
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    oldDatabase
      .prepare(
        `INSERT INTO continuity_host_authorizations (
           id, user_id, persona_id, relationship_id, host_id, grant_hash,
           allowed_event_kinds_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "authorization-schema-17",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "test.conversation-host",
        "b".repeat(64),
        JSON.stringify([continuityConversationTurnEventKind]),
      );
    oldDatabase
      .prepare(
        `INSERT INTO continuity_conversations (
           id, user_id, persona_id, relationship_id, authorization_id,
           host_id, external_conversation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
      )
      .run(
        "conversation-schema-17",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "authorization-schema-17",
        "test.conversation-host",
        "external-schema-17",
      );
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT persona_id, authorization_id, external_conversation_id
             FROM continuity_conversations WHERE id = ?`,
          )
          .get("conversation-schema-17"),
        {
          persona_id: persona.persona.id,
          authorization_id: "authorization-schema-17",
          external_conversation_id: "external-schema-17",
        },
      );
      assert.equal(
        (
          upgraded
            .prepare(
              "SELECT count(*) AS count FROM continuity_conversation_turn_captures",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 18").get(),
        { name: "conversation_capture_recovery_v0.9" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("persona behavior migration preserves schema 18 conversations neutrally", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-behavior-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-18.db");
  mkdirSync(oldMigrations);
  for (const filename of readdirSync(resolve("migrations"))) {
    const version = Number.parseInt(filename.slice(0, 3), 10);
    if (Number.isSafeInteger(version) && version <= 18) {
      copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
    }
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    oldDatabase
      .prepare(
        `INSERT INTO continuity_host_authorizations (
           id, user_id, persona_id, relationship_id, host_id, grant_hash,
           allowed_event_kinds_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "authorization-schema-18",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "test.conversation-host",
        "c".repeat(64),
        JSON.stringify([continuityConversationTurnEventKind]),
      );
    oldDatabase
      .prepare(
        `INSERT INTO continuity_conversations (
           id, user_id, persona_id, relationship_id, authorization_id,
           host_id, external_conversation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "conversation-schema-18",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "authorization-schema-18",
        "test.conversation-host",
        "external-schema-18",
      );
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded
          .prepare(
            `SELECT behavior_profile_id, behavior_profile_revision
             FROM continuity_conversations WHERE id = ?`,
          )
          .get("conversation-schema-18"),
        { behavior_profile_id: null, behavior_profile_revision: null },
      );
      assert.equal(
        (
          upgraded
            .prepare(
              "SELECT count(*) AS count FROM continuity_persona_behavior_profiles",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 19").get(),
        { name: "persona_behavior_profiles_v0.9" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("host deletion migration preserves schema 19 conversations", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-migrate-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  for (const filename of readdirSync(resolve("migrations"))) {
    const version = Number.parseInt(filename.slice(0, 3), 10);
    if (Number.isSafeInteger(version) && version <= 19) {
      copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
    }
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
    const user = personas.createUser({ displayName: "Existing user" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    oldDatabase
      .prepare(
        `INSERT INTO continuity_host_authorizations (
           id, user_id, persona_id, relationship_id, host_id, grant_hash,
           allowed_event_kinds_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "authorization-schema-19",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "test.conversation-host",
        "d".repeat(64),
        JSON.stringify([continuityConversationTurnEventKind]),
      );
    oldDatabase
      .prepare(
        `INSERT INTO continuity_conversations (
           id, user_id, persona_id, relationship_id, authorization_id,
           host_id, external_conversation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
      )
      .run(
        "conversation-schema-19",
        user.id,
        persona.persona.id,
        persona.relationship.id,
        "authorization-schema-19",
        "test.conversation-host",
        "external-schema-19",
      );
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.deepEqual(
        upgraded.prepare("SELECT name FROM schema_migrations WHERE version = 20").get(),
        { name: "conversation_host_deletion_v0.9" },
      );
      assert.equal(
        (
          upgraded
            .prepare(
              "SELECT count(*) AS count FROM continuity_conversation_host_deletions",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(
        upgraded
          .prepare("SELECT id FROM continuity_conversations WHERE id = ?")
          .get("conversation-schema-19"),
        { id: "conversation-schema-19" },
      );
      assert.deepEqual(upgraded.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
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
      const sourceVersionMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 6")
        .get() as { name: string };
      const deletionPurgeMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 7")
        .get() as { name: string };
      const sourceDeletionPurgeMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 8")
        .get() as { name: string };
      const personaFoundationsMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 9")
        .get() as { name: string };
      const personaMemoryClassesMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 10")
        .get() as { name: string };
      const ambientCaptureMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 11")
        .get() as { name: string };
      const ambientSensitivityMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 12")
        .get() as { name: string };
      const temporalRelevanceMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 13")
        .get() as { name: string };
      const authorizedHostCaptureMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 14")
        .get() as { name: string };
      const personaRankingMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 15")
        .get() as { name: string };
      const emotionalRelevanceMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 16")
        .get() as { name: string };
      const conversationMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 17")
        .get() as { name: string };
      const conversationCaptureRecoveryMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 18")
        .get() as { name: string };
      const personaBehaviorMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 19")
        .get() as { name: string };
      const hostDeletionMigration = upgraded
        .prepare("SELECT name FROM schema_migrations WHERE version = 20")
        .get() as { name: string };

      assert.equal(candidate.assertion, "Preserve this candidate.");
      assert.equal(candidate.proposer_id, null);
      assert.equal(candidate.external_id, null);
      assert.deepEqual(policyTable, { present: 1 });
      assert.equal(migration.name, "candidate_review_automation_v0.7");
      assert.equal(legacyMigration.name, "legacy_memory_migration_v0.8");
      assert.equal(resolutionMigration.name, "candidate_resolution_v0.9");
      assert.equal(sourceVersionMigration.name, "source_versioning_v0.9");
      assert.equal(deletionPurgeMigration.name, "memory_deletion_purge_v0.9");
      assert.equal(
        sourceDeletionPurgeMigration.name,
        "source_series_deletion_purge_v0.9",
      );
      assert.equal(personaFoundationsMigration.name, "persona_foundations_v0.9");
      assert.equal(
        personaMemoryClassesMigration.name,
        "persona_memory_classes_v0.9",
      );
      assert.equal(
        ambientCaptureMigration.name,
        "ambient_candidate_capture_v0.9",
      );
      assert.equal(
        ambientSensitivityMigration.name,
        "ambient_sensitivity_assessment_v0.9",
      );
      assert.equal(temporalRelevanceMigration.name, "temporal_relevance_v0.9");
      assert.equal(
        authorizedHostCaptureMigration.name,
        "authorized_host_capture_v0.9",
      );
      assert.equal(personaRankingMigration.name, "persona_ranking_v0.9");
      assert.equal(
        emotionalRelevanceMigration.name,
        "emotional_relevance_v0.9",
      );
      assert.equal(conversationMigration.name, "continuity_conversations_v0.9");
      assert.equal(
        conversationCaptureRecoveryMigration.name,
        "conversation_capture_recovery_v0.9",
      );
      assert.equal(
        personaBehaviorMigration.name,
        "persona_behavior_profiles_v0.9",
      );
      assert.equal(
        hostDeletionMigration.name,
        "conversation_host_deletion_v0.9",
      );
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
    const memoryId = "backfill-memory";
    const scopeId = "backfill-scope";
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    try {
      oldDatabase
        .prepare(
          `INSERT INTO scopes (id, scope_kind, name)
           VALUES (?, 'project', 'Backfill')`,
        )
        .run(scopeId);
      insertLegacyMemory(oldDatabase, {
        memoryId,
        revisionId: "backfill-revision",
        scopeId,
        assertion: "Accepted memory.",
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
        .run(scopeId, memoryId, scopeId);
    } finally {
      oldDatabase.close();
    }

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
          result_memory_id: memoryId,
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

test("source versioning migration preserves existing external sources as version one", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-source-version-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    oldDatabase
      .prepare(
        `INSERT INTO sources (
           id, source_kind, title, external_id, content_hash, created_at
         ) VALUES (
           'source_existing', 'file', 'Existing source', 'file:stable',
           'existing-hash', '2026-10-12T00:00:00.000Z'
         )`,
      )
      .run();
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const version = upgraded
        .prepare(
          `SELECT
             ss.external_id,
             ss.current_source_id,
             sv.source_id,
             sv.version_number,
             sv.previous_source_id
           FROM source_series ss
           JOIN source_versions sv ON sv.series_id = ss.id`,
        )
        .get() as {
        external_id: string;
        current_source_id: string;
        source_id: string;
        version_number: number;
        previous_source_id: string | null;
      };

      assert.deepEqual(version, {
        external_id: "file:stable",
        current_source_id: "source_existing",
        source_id: "source_existing",
        version_number: 1,
        previous_source_id: null,
      });
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("deletion migration records legacy tombstones without inventing a recoverable state", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-deletion-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const memoryId = "legacy-deleted-memory";
    const scopeId = "legacy-deletion-scope";
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    try {
      oldDatabase
        .prepare(
          `INSERT INTO scopes (id, scope_kind, name)
           VALUES (?, 'project', 'Legacy deletion')`,
        )
        .run(scopeId);
      insertLegacyMemory(oldDatabase, {
        memoryId,
        revisionId: "legacy-deleted-revision",
        scopeId,
        assertion: "Previously deleted memory.",
      });
      oldDatabase
        .prepare(
          `UPDATE memory_items
           SET status = 'deleted', deleted_at = '2026-10-12T00:00:00.000Z',
               deletion_reason = 'Legacy tombstone.'
           WHERE id = ?`,
        )
        .run(memoryId);
    } finally {
      oldDatabase.close();
    }

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const event = upgraded
        .prepare(
          `SELECT previous_status, actor_type, is_recoverable, reason
           FROM memory_deletion_events WHERE memory_id = ?`,
        )
        .get(memoryId);
      assert.deepEqual(event, {
        previous_status: "unknown",
        actor_type: "system",
        is_recoverable: 0,
        reason: "Legacy tombstone.",
      });
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("source deletion migration records legacy series tombstones as unrecoverable", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-source-delete-"));
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "existing.db");
  mkdirSync(oldMigrations);
  for (const filename of [
    "001_initial.sql",
    "002_ingestion_candidates.sql",
    "003_review_automation.sql",
    "004_legacy_memory_migration.sql",
    "005_candidate_resolution.sql",
    "006_source_versioning.sql",
    "007_memory_deletion_purge.sql",
  ]) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    oldDatabase.exec(`
      INSERT INTO sources (
        id, source_kind, title, external_id, deleted_at
      ) VALUES (
        'source_legacy_deleted',
        'file',
        'Legacy deleted source',
        'file:legacy-deleted',
        '2026-10-12T00:00:00.000Z'
      );
      INSERT INTO source_series (
        id, source_kind, external_id, current_source_id
      ) VALUES (
        'series_legacy_deleted',
        'file',
        'file:legacy-deleted',
        'source_legacy_deleted'
      );
      INSERT INTO source_versions (
        source_id, series_id, version_number
      ) VALUES (
        'source_legacy_deleted',
        'series_legacy_deleted',
        1
      );
    `);
    oldDatabase.close();

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const event = upgraded
        .prepare(
          `SELECT actor_type, is_recoverable, reason
           FROM source_series_deletion_events`,
        )
        .get();
      assert.deepEqual(event, {
        actor_type: "system",
        is_recoverable: 0,
        reason: "Pre-migration source deletion",
      });
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
