import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  PersonaService,
  SqlitePersonaRepository,
  applyBackupRetention,
  createDatabaseSnapshot,
  databaseSafeguardIdentity,
  getAutomaticBackupStatus,
  getRestoreDrillStatus,
  openMemTextualDatabase,
  previewBackupRetention,
  runAutomaticBackupIfDue,
  runRestoreDrillIfDue,
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
    assert.match(result.manifest.sourceDatabaseIdentity, /^[a-f0-9]{64}$/u);
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

test("retention preview keeps explicit daily, weekly, and monthly recovery points", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    for (const createdAt of [
      "2026-08-15T12:00:00.000Z",
      "2026-09-15T12:00:00.000Z",
      "2026-10-05T12:00:00.000Z",
      "2026-10-12T12:00:00.000Z",
      "2026-10-13T12:00:00.000Z",
    ]) {
      await createDatabaseSnapshot({
        databasePath: fixture.databasePath,
        outputDirectory,
        now: new Date(createdAt),
      });
    }
    const incompleteDirectory = join(
      outputDirectory,
      "memtextual-2026-07-01T12-00-00-000Z",
    );
    mkdirSync(incompleteDirectory);

    const preview = previewBackupRetention({
      databasePath: fixture.databasePath,
      outputDirectory,
      policy: {
        dailyCount: 2,
        weeklyCount: 2,
        monthlyCount: 2,
        timeZone: "America/Los_Angeles",
        weekStartsOn: 1,
      },
      now: new Date("2026-10-13T13:00:00.000Z"),
    });

    assert.equal(preview.keepCount, 4);
    assert.equal(preview.deleteCount, 1);
    assert.equal(preview.protectCount, 1);
    assert.match(preview.confirmation, /^DELETE 1 BACKUPS [a-f0-9]{16}$/u);
    assert.deepEqual(
      preview.snapshots
        .filter(({ decision }) => decision === "delete")
        .map(({ createdAt }) => createdAt),
      ["2026-08-15T12:00:00.000Z"],
    );
    const newest = preview.snapshots.find(
      ({ createdAt }) => createdAt === "2026-10-13T12:00:00.000Z",
    );
    assert.deepEqual(newest?.retainedBy, ["newest", "daily", "weekly", "monthly"]);
    const protectedSnapshot = preview.snapshots.find(
      ({ decision }) => decision === "protect",
    );
    assert.match(protectedSnapshot?.problems[0] ?? "", /Manifest is missing/u);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("retention apply requires a fresh exact confirmation and writes a receipt", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    for (const createdAt of [
      "2026-10-10T12:00:00.000Z",
      "2026-10-11T12:00:00.000Z",
      "2026-10-12T12:00:00.000Z",
    ]) {
      await createDatabaseSnapshot({
        databasePath: fixture.databasePath,
        outputDirectory,
        now: new Date(createdAt),
      });
    }
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      policy: {
        dailyCount: 1,
        weeklyCount: 0,
        monthlyCount: 0,
        timeZone: "UTC",
        weekStartsOn: 1,
      },
      now: new Date("2026-10-14T00:00:00.000Z"),
    } as const;
    const preview = previewBackupRetention(options);
    assert.equal(preview.deleteCount, 2);
    assert.throws(
      () => applyBackupRetention({ ...options, confirmation: "wrong" }),
      /does not match the current preview/u,
    );
    for (const snapshot of preview.snapshots) {
      assert.equal(existsSync(join(outputDirectory, snapshot.directory)), true);
    }

    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    assert.throws(
      () =>
        applyBackupRetention({
          ...options,
          confirmation: preview.confirmation,
        }),
      /does not match the current preview/u,
    );

    const fresh = previewBackupRetention(options);
    const receipt = applyBackupRetention({
      ...options,
      confirmation: fresh.confirmation,
    });
    assert.equal(receipt.deletedDirectories.length, 3);
    assert.equal(existsSync(receipt.receiptPath), true);
    for (const directory of receipt.deletedDirectories) {
      assert.equal(existsSync(join(outputDirectory, directory)), false);
    }
    const remaining = previewBackupRetention(options);
    assert.equal(remaining.deleteCount, 0);
    assert.equal(remaining.keepCount, 1);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("retention protects corrupted snapshots and rejects implicit policy choices", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    writeFileSync(snapshot.backupPath, "corrupted", "utf8");
    const legacy = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const legacyManifest = JSON.parse(
      readFileSync(legacy.manifestPath, "utf8"),
    ) as Record<string, unknown>;
    delete legacyManifest.sourceDatabaseIdentity;
    writeFileSync(
      legacy.manifestPath,
      `${JSON.stringify(legacyManifest, null, 2)}\n`,
      "utf8",
    );
    const preview = previewBackupRetention({
      databasePath: fixture.databasePath,
      outputDirectory,
      policy: {
        dailyCount: 1,
        weeklyCount: 0,
        monthlyCount: 0,
        timeZone: "UTC",
        weekStartsOn: 1,
      },
    });
    assert.equal(preview.protectCount, 2);
    assert.equal(preview.deleteCount, 0);
    assert.ok(
      preview.snapshots.some(({ problems }) => problems.join(" ").includes("hash")),
    );
    assert.ok(
      preview.snapshots.some(({ problems }) =>
        problems.join(" ").includes("identity"),
      ),
    );

    assert.throws(
      () =>
        previewBackupRetention({
          databasePath: fixture.databasePath,
          outputDirectory,
          policy: {
            dailyCount: 0,
            weeklyCount: 1,
            monthlyCount: 1,
            timeZone: "UTC",
            weekStartsOn: 1,
          },
        }),
      /dailyCount must be an integer between 1/u,
    );
    assert.throws(
      () =>
        previewBackupRetention({
          databasePath: fixture.databasePath,
          outputDirectory,
          policy: {
            dailyCount: 1,
            weeklyCount: 1,
            monthlyCount: 1,
            timeZone: "UTC",
            weekStartsOn: 7,
          },
        }),
      /weekStartsOn must be an integer/u,
    );
    assert.throws(
      () =>
        previewBackupRetention({
          databasePath: fixture.databasePath,
          outputDirectory,
          policy: {
            dailyCount: 1,
            weeklyCount: 1,
            monthlyCount: 1,
            timeZone: "not-a-zone",
            weekStartsOn: 1,
          },
        }),
      /Unsupported backup retention timeZone/u,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("restore drill verifies the newest recovery point only when due", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const newest = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 168,
    } as const;

    const first = runRestoreDrillIfDue({
      ...options,
      now: new Date("2026-10-14T12:00:00.000Z"),
    });
    assert.equal(first.outcome, "performed");
    assert.equal(first.report?.passed, true);
    assert.equal(
      first.report?.snapshotDirectory,
      basename(dirname(newest.backupPath)),
    );
    assert.equal(first.report?.protectedSnapshotCount, 0);
    assert.equal(first.report?.verifiedSnapshotCount, 2);
    assert.equal(first.report?.disposableCopyRemoved, true);
    assert.ok((first.report?.checkedTables ?? 0) > 0);
    assert.equal(first.status.health, "healthy");
    assert.equal(first.status.due, false);
    assert.equal(first.status.nextDueAt, "2026-10-21T12:00:00.000Z");
    assert.equal(existsSync(first.report?.reportPath ?? ""), true);

    const early = runRestoreDrillIfDue({
      ...options,
      now: new Date("2026-10-21T11:59:59.000Z"),
    });
    assert.equal(early.outcome, "not_due");
    assert.equal(early.status.health, "healthy");

    const lockPath = join(
      outputDirectory,
      `automatic-backup-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}.lock`,
    );
    writeFileSync(lockPath, "held", "utf8");
    assert.throws(
      () =>
        runRestoreDrillIfDue({
          ...options,
          now: new Date("2026-10-21T11:59:59.000Z"),
        }),
      /operation is in progress/u,
    );
    rmSync(lockPath);

    const due = getRestoreDrillStatus({
      ...options,
      now: new Date("2026-10-21T12:00:00.000Z"),
    });
    assert.equal(due.due, true);
    assert.equal(due.health, "overdue");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("restore drill fails closed when the newest recovery point is corrupt", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const newest = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    writeFileSync(newest.backupPath, "corrupted", "utf8");
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 168,
      now: new Date("2026-10-14T12:00:00.000Z"),
    } as const;

    assert.throws(
      () => runRestoreDrillIfDue(options),
      /newer recovery point is protected and not verifiable/u,
    );
    const status = getRestoreDrillStatus(options);
    assert.equal(status.health, "failed");
    assert.equal(status.due, true);
    assert.equal(status.lastSuccessfulAt, null);
    assert.equal(status.lastSnapshotDirectory, null);
    assert.equal(existsSync(status.lastReportPath ?? ""), true);
    const report = JSON.parse(
      readFileSync(status.lastReportPath ?? "", "utf8"),
    ) as { passed: boolean; protectedSnapshotCount: number };
    assert.equal(report.passed, false);
    assert.equal(report.protectedSnapshotCount, 1);

    rmSync(dirname(newest.backupPath), { force: true, recursive: true });
    mkdirSync(join(outputDirectory, "memtextual-unknown-time"));
    assert.throws(
      () => runRestoreDrillIfDue(options),
      /unknown creation time and is protected/u,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("restore drill records missing backups and rejects invalid state or intervals", () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      intervalHours: 24,
      now: new Date("2026-10-14T12:00:00.000Z"),
    } as const;
    assert.throws(
      () => runRestoreDrillIfDue(options),
      /No verified recovery point is available/u,
    );
    const failed = getRestoreDrillStatus(options);
    assert.equal(failed.health, "failed");
    assert.equal(failed.due, true);
    assert.ok(failed.statePath !== null);
    writeFileSync(failed.statePath, "not-json", "utf8");
    assert.throws(
      () => getRestoreDrillStatus(options),
      /state is not valid JSON/u,
    );
    assert.throws(
      () =>
        getRestoreDrillStatus({
          ...options,
          intervalHours: 0,
        }),
      /greater than 0/u,
    );
    assert.throws(
      () =>
        getRestoreDrillStatus({
          ...options,
          intervalHours: 8_761,
        }),
      /no more than 8760/u,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});
