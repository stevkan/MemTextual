import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  PersonaService,
  SqlitePersonaRepository,
  createDatabaseSnapshot,
  getAutomaticBackupStatus,
  openMemTextualDatabase,
  runAutomaticBackupIfDue,
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
    assert.equal(
      result.manifest.protectedTables.continuity_emotional_profiles?.rowCount,
      0,
    );
    assert.equal(result.manifest.migrations.length, 16);

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

test("automatic backup creates a verified recovery point only when due", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "automatic-backups");
    const first = await runAutomaticBackupIfDue({
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-13T08:00:00.000Z"),
    });
    assert.equal(first.outcome, "created");
    assert.equal(first.status.health, "healthy");
    assert.equal(first.status.due, false);
    assert.equal(first.status.lastVerifiedAt, "2026-10-13T08:00:00.000Z");
    assert.equal(first.status.nextDueAt, "2026-10-14T08:00:00.000Z");
    assert.ok(first.snapshot !== undefined);

    const early = await runAutomaticBackupIfDue({
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-14T07:59:59.000Z"),
    });
    assert.equal(early.outcome, "not_due");
    assert.equal(early.status.health, "healthy");

    const due = getAutomaticBackupStatus({
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-14T08:00:00.000Z"),
    });
    assert.equal(due.due, true);
    assert.equal(due.health, "overdue");

    const second = await runAutomaticBackupIfDue({
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-14T08:00:00.000Z"),
    });
    assert.equal(second.outcome, "created");
    assert.equal(second.status.health, "healthy");
    assert.notEqual(
      second.status.lastSnapshotDirectory,
      first.status.lastSnapshotDirectory,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("automatic backup records failures and reports that action is required", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "automatic-backups");
    await assert.rejects(
      runAutomaticBackupIfDue({
        databasePath: join(fixture.directory, "missing.db"),
        outputDirectory,
        intervalHours: 12,
        now: new Date("2026-10-13T09:00:00.000Z"),
      }),
      /Automatic backup failed/u,
    );
    const status = getAutomaticBackupStatus({
      databasePath: join(fixture.directory, "missing.db"),
      outputDirectory,
      intervalHours: 12,
      now: new Date("2026-10-13T09:01:00.000Z"),
    });
    assert.equal(status.health, "failed");
    assert.equal(status.due, true);
    assert.equal(status.lastSuccessfulAt, null);
    assert.match(status.lastFailure?.message ?? "", /open database file/u);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("automatic backup configuration and state fail closed", async () => {
  const fixture = setup();
  try {
    await assert.rejects(
      runAutomaticBackupIfDue({
        databasePath: fixture.databasePath,
        outputDirectory: fixture.directory,
        intervalHours: 24,
      }),
      /destination must differ/u,
    );
    await assert.rejects(
      runAutomaticBackupIfDue({
        databasePath: fixture.databasePath,
        outputDirectory: join(fixture.directory, "backups"),
        intervalHours: 25,
      }),
      /no more than 24/u,
    );

    const outputDirectory = join(fixture.directory, "backups");
    const first = await runAutomaticBackupIfDue({
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-13T10:00:00.000Z"),
    });
    assert.ok(first.status.statePath !== null);
    writeFileSync(first.status.statePath, "not-json", "utf8");
    assert.throws(
      () =>
        getAutomaticBackupStatus({
          databasePath: fixture.databasePath,
          outputDirectory,
          intervalHours: 24,
        }),
      /state is not valid JSON/u,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("snapshot creation refuses to reuse an existing timestamp directory", async () => {
  const fixture = setup();
  try {
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory: join(fixture.directory, "backups"),
      now: new Date("2026-10-13T11:00:00.000Z"),
    };
    await createDatabaseSnapshot(options);
    await assert.rejects(createDatabaseSnapshot(options), /EEXIST/u);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
