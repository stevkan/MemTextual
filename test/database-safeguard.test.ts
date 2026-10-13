import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  PersonaService,
  SqlitePersonaRepository,
  createDatabaseSnapshot,
  openMemTextualDatabase,
  verifyDatabaseAgainstManifest,
} from "../src/index.js";

function setup(): { databasePath: string; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-safeguard-"));
  const databasePath = join(directory, "source.db");
  const database = openMemTextualDatabase({
    filename: databasePath,
    migrationsDirectory: resolve("migrations"),
  });
  database
    .prepare(
      "INSERT INTO scopes(id, scope_kind, name, external_key) VALUES (?, 'project', ?, ?)",
    )
    .run("scope-1", "Continuity", "continuity");
  const personas = new PersonaService(new SqlitePersonaRepository(database));
  const user = personas.createUser({ displayName: "Steve" });
  personas.createPersona({ userId: user.id, name: "Skylar" });
  database.close();
  return { databasePath, directory };
}

test("snapshot creates an integrity-checked backup, manifest, and durable export", async () => {
  const fixture = setup();
  try {
    const result = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      now: new Date("2026-10-12T12:00:00.000Z"),
      outputDirectory: join(fixture.directory, "backups"),
    });

    assert.equal(result.manifest.integrityCheck, "ok");
    assert.equal(result.manifest.protectedTables.scopes?.rowCount, 4);
    assert.equal(result.manifest.protectedTables.memory_items?.rowCount, 0);
    assert.equal(result.manifest.protectedTables.memory_embeddings, undefined);
    assert.equal(
      result.manifest.protectedTables.continuity_ranking_profiles?.rowCount,
      1,
    );
    assert.equal(result.manifest.migrations.length, 15);

    const export_ = JSON.parse(readFileSync(result.exportPath, "utf8")) as {
      tables: { scopes: Array<{ id: string }> };
    };
    assert.ok(export_.tables.scopes.some(({ id }) => id === "scope-1"));

    const verification = verifyDatabaseAgainstManifest({
      databasePath: result.backupPath,
      manifestPath: result.manifestPath,
    });
    assert.equal(verification.passed, true);
    assert.deepEqual(verification.problems, []);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("verification permits additive schema changes and rejects durable data loss", async () => {
  const fixture = setup();
  try {
    const result = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: join(fixture.directory, "backups"),
    });
    const database = openMemTextualDatabase({ filename: fixture.databasePath });
    database.exec("ALTER TABLE scopes ADD COLUMN continuity_note TEXT");
    database.close();

    const additive = verifyDatabaseAgainstManifest({
      databasePath: fixture.databasePath,
      manifestPath: result.manifestPath,
    });
    assert.equal(additive.passed, true);

    const tampered = openMemTextualDatabase({ filename: fixture.databasePath });
    tampered.prepare("DELETE FROM scopes WHERE id = ?").run("scope-1");
    tampered.close();

    const destructive = verifyDatabaseAgainstManifest({
      databasePath: fixture.databasePath,
      manifestPath: result.manifestPath,
    });
    assert.equal(destructive.passed, false);
    assert.ok(destructive.problems.some((problem) => problem.includes("row count")));
    assert.ok(destructive.problems.some((problem) => problem.includes("content hash")));
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
