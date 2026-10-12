import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    assert.equal(migrationCount.count, 2);
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
