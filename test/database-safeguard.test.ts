import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  ContinuityPersonaBehaviorService,
  PersonaService,
  SqliteContinuityPersonaBehaviorRepository,
  SqlitePersonaRepository,
  assertDatabaseSnapshotWriteAccess,
  applyScheduledReplicationRetirement,
  applyGuidedRestore,
  applyBackupRetention,
  createLocalDirectoryReplicationAdapter,
  createConfiguredReplicationDestinationAdapter,
  createDatabaseSnapshot,
  createEncryptedReplication,
  databaseSafeguardIdentity,
  getAutomaticBackupStatus,
  getOffsiteReplicationStatus,
  getScheduledReplicationStatus,
  getRestoreDrillStatus,
  importEncryptedReplication,
  loadReplicationDestinationConfiguration,
  openMemTextualDatabase,
  previewGuidedRestore,
  previewBackupRetention,
  previewScheduledReplicationRetirement,
  parseReplicationDestinationConfiguration,
  publishReplicationPackage,
  runAutomaticBackupIfDue,
  runOffsiteReplicationIfDue,
  runScheduledReplicationIfDue,
  runRestoreDrillIfDue,
  verifyEncryptedReplication,
  verifyDatabaseAgainstManifest,
  type ReplicationDestinationAdapter,
} from "../src/index.js";

test("snapshot preflight fails clearly when a WAL sidecar is not writable", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-snapshot-access-"));
  const databasePath = join(directory, "memtextual.db");
  writeFileSync(databasePath, "database", "utf8");
  writeFileSync(`${databasePath}-wal`, "", "utf8");
  writeFileSync(`${databasePath}-shm`, "shared-memory", "utf8");
  const checked: string[] = [];
  try {
    assert.throws(
      () => assertDatabaseSnapshotWriteAccess(
        databasePath,
        (path) => {
          checked.push(path);
          if (path.endsWith("-shm")) {
            const error = new Error("access denied") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
          }
        },
      ),
      /requires read and write access to the SQLite WAL sidecar.*managed identity or an elevated account/u,
    );
    assert.deepEqual(checked, [
      directory,
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("provider-neutral scheduled replication publishes, rematerializes, and detects a missing remote package", async () => {
  const fixture = setup();
  const backupDirectory = join(fixture.directory, "backups");
  const remoteDirectory = join(fixture.directory, "remote");
  mkdirSync(remoteDirectory);
  const key = randomBytes(32);
  const rotatedKey = randomBytes(32);
  try {
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      now: new Date("2026-10-14T12:00:00.000Z"),
      outputDirectory: backupDirectory,
    });
    const local = createLocalDirectoryReplicationAdapter(remoteDirectory);
    const adapter: ReplicationDestinationAdapter = {
      ...local,
      adapterId: "test-remote",
    };
    const result = await runScheduledReplicationIfDue({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      keyId: "test-key",
      masterKey: key,
      now: new Date("2026-10-14T12:01:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    assert.equal(result.outcome, "replicated");
    assert.equal(result.status.health, "healthy");
    assert.equal(result.status.lastPackageAvailable, true);
    assert.equal(result.verification?.passed, true);
    assert.equal(result.status.adapterId, "test-remote");

    const originalPackageName = result.publication?.packageName;
    assert.ok(originalPackageName);
    const rotation = await runScheduledReplicationIfDue({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      keyId: "test-key-r2",
      masterKey: rotatedKey,
      now: new Date("2026-10-14T12:02:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    assert.equal(rotation.outcome, "replicated");
    assert.equal(rotation.status.lastKeyId, "test-key-r2");
    assert.equal(rotation.status.lastPackageAvailable, true);
    assert.equal(rotation.verification?.passed, true);
    assert.notEqual(rotation.publication?.packageName, originalPackageName);

    const early = await runScheduledReplicationIfDue({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      keyId: "test-key-r2",
      masterKey: rotatedKey,
      now: new Date("2026-10-14T12:03:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    assert.equal(early.outcome, "not_due");

    const packageName = rotation.publication?.packageName;
    assert.ok(packageName);
    rmSync(join(remoteDirectory, packageName, "database.enc"));
    const status = await getScheduledReplicationStatus({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      now: new Date("2026-10-14T12:02:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    assert.equal(status.health, "unavailable");
    assert.equal(status.due, true);
    assert.equal(status.lastPackageAvailable, false);
  } finally {
    key.fill(0);
    rotatedKey.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("scheduled replication retirement requires an exact fresh confirmation and preserves the verified replacement", async () => {
  const fixture = setup();
  const backupDirectory = join(fixture.directory, "backups");
  const remoteDirectory = join(fixture.directory, "remote");
  mkdirSync(remoteDirectory);
  const key = randomBytes(32);
  const rotatedKey = randomBytes(32);
  try {
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: backupDirectory,
      now: new Date("2026-10-14T12:00:00.000Z"),
    });
    const adapter = createLocalDirectoryReplicationAdapter(remoteDirectory);
    const first = await runScheduledReplicationIfDue({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      keyId: "test-key-r1",
      masterKey: key,
      now: new Date("2026-10-14T12:01:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    const replacement = await runScheduledReplicationIfDue({
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      keyId: "test-key-r2",
      masterKey: rotatedKey,
      now: new Date("2026-10-14T12:02:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    });
    const legacyPackageName = first.publication?.packageName ?? "";
    const replacementPackageName = replacement.publication?.packageName ?? "";
    const options = {
      adapter,
      databasePath: fixture.databasePath,
      intervalHours: 24,
      legacyPackageName,
      now: new Date("2026-10-14T12:03:00.000Z"),
      sourceBackupDirectory: backupDirectory,
    };
    const preview = await previewScheduledReplicationRetirement(options);
    const destinationConfigurationPath = join(
      fixture.directory,
      "retirement-destination.json",
    );
    writeFileSync(
      destinationConfigurationPath,
      JSON.stringify({
        adapterId: "local-directory",
        destinationDirectory: remoteDirectory,
        formatVersion: 1,
      }),
      "utf8",
    );
    const cliPreview = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "safeguard.ts"),
        "offsite-retire-preview",
        "--database",
        fixture.databasePath,
        "--source",
        backupDirectory,
        "--destination-config",
        destinationConfigurationPath,
        "--interval-hours",
        "24",
        "--legacy-package",
        legacyPackageName,
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(cliPreview.status, 0, cliPreview.stderr);
    assert.equal(
      (JSON.parse(cliPreview.stdout) as { confirmation: string }).confirmation,
      preview.confirmation,
    );
    assert.match(
      preview.confirmation,
      /^RETIRE-OFFSITE-PACKAGE-[A-F0-9]{20}$/u,
    );
    assert.equal(preview.legacy.keyId, "test-key-r1");
    assert.equal(preview.replacement.keyId, "test-key-r2");

    await assert.rejects(
      applyScheduledReplicationRetirement({
        ...options,
        confirmation: "RETIRE-OFFSITE-PACKAGE-WRONG",
      }),
      /confirmation is missing, incorrect, or stale/u,
    );
    assert.equal(existsSync(join(remoteDirectory, legacyPackageName)), true);

    const result = await applyScheduledReplicationRetirement({
      ...options,
      confirmation: preview.confirmation,
    });
    assert.equal(existsSync(join(remoteDirectory, legacyPackageName)), false);
    assert.equal(existsSync(join(remoteDirectory, replacementPackageName)), true);
    assert.equal(existsSync(result.receiptPath), true);
    assert.match(readFileSync(result.receiptPath, "utf8"), /"completedAt"/u);
  } finally {
    key.fill(0);
    rotatedKey.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

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
  const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
  const behaviors = new ContinuityPersonaBehaviorService(
    new SqliteContinuityPersonaBehaviorRepository(database),
  );
  behaviors.configureProfile(
    {
      personaId: persona.persona.id,
      expectedRevisionNumber: null,
      instructions: "Be warm and concise.",
      enabled: true,
    },
    { actor: "user", explicitUserAction: true },
  );
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
    assert.equal(
      result.manifest.protectedTables.continuity_conversations?.rowCount,
      0,
    );
    assert.equal(
      result.manifest.protectedTables.continuity_conversation_turn_captures
        ?.rowCount,
      0,
    );
    assert.equal(
      result.manifest.protectedTables.continuity_persona_behavior_profiles
        ?.rowCount,
      1,
    );
    assert.equal(result.manifest.migrations.length, 21);

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
    assert.match(
      status.lastFailure?.message ?? "",
      /requires read and write access to the database file/u,
    );
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

test("guided restore previews and applies an explicitly confirmed recovery point", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    const selected = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const selectedDirectory = basename(dirname(selected.backupPath));
    const changed = openMemTextualDatabase({ filename: fixture.databasePath });
    changed
      .prepare(
        "INSERT INTO scopes(id, scope_kind, name, external_key) VALUES (?, 'project', ?, ?)",
      )
      .run("after-snapshot", "Later state", "later-state");
    changed.close();
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      snapshotDirectory: selectedDirectory,
      now: new Date("2026-10-14T12:00:00.000Z"),
    } as const;

    const preview = previewGuidedRestore(options);
    assert.equal(preview.selectedSnapshotDirectory, selectedDirectory);
    assert.equal(preview.selectedCreatedAt, "2026-10-12T12:00:00.000Z");
    assert.deepEqual(preview.newerVerifiedSnapshots, []);
    assert.match(preview.confirmation, /^RESTORE source\.db FROM memtextual-/u);
    await assert.rejects(
      applyGuidedRestore({ ...options, confirmation: "wrong" }),
      /confirmation does not match/u,
    );

    const result = await applyGuidedRestore({
      ...options,
      confirmation: preview.confirmation,
    });
    assert.equal(result.report.selectedSnapshotDirectory, selectedDirectory);
    assert.equal(result.report.restoredDatabaseSha256, selected.manifest.backupSha256);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.rollbackDirectory, null);
    assert.equal(existsSync(result.report.reportPath), true);
    assert.equal(existsSync(result.cleanupReceiptPath ?? ""), true);

    const restored = openMemTextualDatabase({ filename: fixture.databasePath });
    assert.equal(
      restored.prepare("SELECT 1 FROM scopes WHERE id = ?").get("after-snapshot"),
      undefined,
    );
    restored.close();

    const preRestore = join(
      outputDirectory,
      result.preRestoreSnapshotDirectory,
      "memtextual.db",
    );
    const preserved = openMemTextualDatabase({ filename: preRestore });
    assert.ok(
      preserved.prepare("SELECT 1 FROM scopes WHERE id = ?").get("after-snapshot") !==
        undefined,
    );
    preserved.close();
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("guided restore invalidates stale confirmation and rejects unsafe recovery points", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    const selected = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const selectedDirectory = basename(dirname(selected.backupPath));
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      snapshotDirectory: selectedDirectory,
      now: new Date("2026-10-14T12:00:00.000Z"),
    } as const;
    const preview = previewGuidedRestore(options);
    const lockPath = join(
      outputDirectory,
      `automatic-backup-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}.lock`,
    );
    writeFileSync(lockPath, "held", "utf8");
    await assert.rejects(
      applyGuidedRestore({ ...options, confirmation: preview.confirmation }),
      /operation is in progress/u,
    );
    rmSync(lockPath);
    const changed = openMemTextualDatabase({ filename: fixture.databasePath });
    changed
      .prepare(
        "INSERT INTO scopes(id, scope_kind, name, external_key) VALUES (?, 'project', ?, ?)",
      )
      .run("after-preview", "Changed state", "changed-state");
    changed.close();

    await assert.rejects(
      applyGuidedRestore({
        ...options,
        confirmation: preview.confirmation,
      }),
      /confirmation does not match the current preview/u,
    );
    const unchanged = openMemTextualDatabase({ filename: fixture.databasePath });
    assert.ok(
      unchanged.prepare("SELECT 1 FROM scopes WHERE id = ?").get("after-preview") !==
        undefined,
    );
    unchanged.close();

    writeFileSync(selected.backupPath, "corrupted", "utf8");
    assert.throws(
      () => previewGuidedRestore(options),
      /protected and not verifiable/u,
    );
    assert.throws(
      () =>
        previewGuidedRestore({
          ...options,
          snapshotDirectory: "..\\outside",
        }),
      /must name one direct/u,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("guided restore leaves the live database unchanged and records a busy failure", async () => {
  const fixture = setup();
  try {
    const outputDirectory = join(fixture.directory, "backups");
    const selected = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const options = {
      databasePath: fixture.databasePath,
      outputDirectory,
      snapshotDirectory: basename(dirname(selected.backupPath)),
      now: new Date("2026-10-14T12:00:00.000Z"),
    } as const;
    const preview = previewGuidedRestore(options);
    const blocker = openMemTextualDatabase({ filename: fixture.databasePath });
    blocker.exec("BEGIN IMMEDIATE");
    try {
      await assert.rejects(
        applyGuidedRestore({ ...options, confirmation: preview.confirmation }),
        /database is busy/u,
      );
    } finally {
      blocker.exec("ROLLBACK");
      blocker.close();
    }

    const database = openMemTextualDatabase({ filename: fixture.databasePath });
    assert.ok(database.prepare("SELECT 1 FROM scopes WHERE id = ?").get("scope-1"));
    database.close();
    const reportDirectory = join(
      outputDirectory,
      `.restore-reports-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}`,
    );
    assert.equal(
      readdirSync(reportDirectory).some((filename) => filename.endsWith(".failed.json")),
      true,
    );
    assert.equal(
      readdirSync(reportDirectory).some((filename) => filename.endsWith(".planned.json")),
      false,
    );
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("encrypted replication creates and decrypt-verifies an authenticated package", async () => {
  const fixture = setup();
  const destinationDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-destination-"),
  );
  const key = randomBytes(32);
  try {
    const sourceBackupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const result = await createEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory,
      keyId: "recovery-key-2026",
      masterKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      sourceBackupDirectory,
    });

    assert.equal(result.manifest.algorithm, "aes-256-gcm");
    assert.equal(result.manifest.kdf, "hkdf-sha256");
    assert.equal(result.manifest.files.length, 3);
    assert.equal(result.verification.passed, true);
    assert.equal(result.verification.fileCount, 3);
    assert.equal(existsSync(result.verification.reportPath), true);
    assert.equal(existsSync(join(result.packageDirectory, "memtextual.db")), false);
    assert.equal(
      existsSync(join(result.packageDirectory, "durable-data-export.json")),
      false,
    );
    assert.equal(
      readFileSync(result.manifestPath, "utf8").includes(key.toString("base64")),
      false,
    );
    assert.notEqual(
      readFileSync(join(result.packageDirectory, "database.enc"))
        .subarray(0, 16)
        .toString("utf8"),
      "SQLite format 3\u0000",
    );

    const verifiedAgain = await verifyEncryptedReplication({
      masterKey: key,
      now: new Date("2026-10-14T13:00:00.000Z"),
      packageDirectory: result.packageDirectory,
    });
    assert.equal(verifiedAgain.checkedTables, result.verification.checkedTables);

    await assert.rejects(
      verifyEncryptedReplication({
        masterKey: randomBytes(32),
        packageDirectory: result.packageDirectory,
      }),
      /authenticate|authentication|unsupported state/iu,
    );
    const encryptedDatabasePath = join(result.packageDirectory, "database.enc");
    const tampered = readFileSync(encryptedDatabasePath);
    const tamperedIndex = Math.floor(tampered.length / 2);
    tampered[tamperedIndex] = (tampered[tamperedIndex] ?? 0) ^ 1;
    writeFileSync(encryptedDatabasePath, tampered);
    await assert.rejects(
      verifyEncryptedReplication({
        masterKey: key,
        packageDirectory: result.packageDirectory,
      }),
      /authenticate|authentication|unsupported state/iu,
    );
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(destinationDirectory, { force: true, recursive: true });
  }
});

test("encrypted replication rejects unsafe destinations, keys, locks, and snapshots", async () => {
  const fixture = setup();
  const destinationDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-destination-"),
  );
  const key = randomBytes(32);
  try {
    const sourceBackupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const options = {
      databasePath: fixture.databasePath,
      destinationDirectory,
      keyId: "recovery-key-2026",
      masterKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      sourceBackupDirectory,
    } as const;

    await assert.rejects(
      createEncryptedReplication({
        ...options,
        destinationDirectory: sourceBackupDirectory,
      }),
      /must not overlap/u,
    );
    await assert.rejects(
      createEncryptedReplication({
        ...options,
        destinationDirectory: join(destinationDirectory, "missing"),
      }),
      /Replication destination does not exist/u,
    );
    assert.equal(existsSync(join(destinationDirectory, "missing")), false);
    await assert.rejects(
      createEncryptedReplication({ ...options, masterKey: randomBytes(31) }),
      /exactly 32 bytes/u,
    );
    const lockPath = join(
      sourceBackupDirectory,
      `automatic-backup-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}.lock`,
    );
    writeFileSync(lockPath, "held", "utf8");
    await assert.rejects(
      createEncryptedReplication(options),
      /operation is in progress/u,
    );
    rmSync(lockPath);

    writeFileSync(snapshot.backupPath, "corrupted", "utf8");
    await assert.rejects(
      createEncryptedReplication(options),
      /protected and not verifiable/u,
    );
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(destinationDirectory, { force: true, recursive: true });
  }
});

test("encrypted replication import creates a verified local recovery point without changing the live database", async () => {
  const fixture = setup();
  const offsiteDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-import-source-"),
  );
  const key = randomBytes(32);
  try {
    const localBackupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: localBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const snapshotDirectory = basename(dirname(snapshot.backupPath));
    const replication = await createEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory: offsiteDirectory,
      keyId: "recovery-key-2026",
      masterKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      snapshotDirectory,
      sourceBackupDirectory: localBackupDirectory,
    });
    rmSync(dirname(snapshot.backupPath), { force: true, recursive: true });

    const liveDatabase = openMemTextualDatabase({ filename: fixture.databasePath });
    liveDatabase
      .prepare(
        "INSERT INTO scopes(id, scope_kind, name, external_key) VALUES (?, 'project', ?, ?)",
      )
      .run("live-after-package", "Live after package", "live-after-package");
    liveDatabase.close();

    const imported = await importEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory: localBackupDirectory,
      masterKey: key,
      now: new Date("2026-10-15T12:00:00.000Z"),
      packageDirectory: replication.packageDirectory,
    });

    assert.equal(imported.snapshotDirectory, snapshotDirectory);
    assert.equal(imported.warnings.length, 0);
    assert.ok(imported.checkedTables > 0);
    assert.equal(existsSync(imported.receiptPath), true);
    assert.equal(existsSync(imported.snapshotPath), true);
    const importedVerification = verifyDatabaseAgainstManifest({
      databasePath: join(imported.snapshotPath, "memtextual.db"),
      manifestPath: join(imported.snapshotPath, "manifest.json"),
    });
    assert.equal(importedVerification.passed, true);

    const restoredDatabase = openMemTextualDatabase({
      filename: join(imported.snapshotPath, "memtextual.db"),
    });
    assert.equal(
      restoredDatabase
        .prepare("SELECT 1 FROM scopes WHERE id = ?")
        .get("live-after-package"),
      undefined,
    );
    restoredDatabase.close();
    const unchangedLiveDatabase = openMemTextualDatabase({
      filename: fixture.databasePath,
    });
    assert.ok(
      unchangedLiveDatabase
        .prepare("SELECT 1 FROM scopes WHERE id = ?")
        .get("live-after-package"),
    );
    unchangedLiveDatabase.close();

    const preview = previewBackupRetention({
      databasePath: fixture.databasePath,
      outputDirectory: localBackupDirectory,
      now: new Date("2026-10-15T13:00:00.000Z"),
      policy: {
        dailyCount: 7,
        monthlyCount: 12,
        timeZone: "UTC",
        weekStartsOn: 1,
        weeklyCount: 4,
      },
    });
    assert.ok(
      preview.snapshots.some(
        (candidate) =>
          candidate.directory === snapshotDirectory &&
          candidate.problems.length === 0,
      ),
    );

    await assert.rejects(
      importEncryptedReplication({
        databasePath: fixture.databasePath,
        destinationDirectory: localBackupDirectory,
        masterKey: key,
        packageDirectory: replication.packageDirectory,
      }),
      /already exists and will not be overwritten/u,
    );
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(offsiteDirectory, { force: true, recursive: true });
  }
});

test("encrypted replication import rejects unsafe keys, destinations, identities, and locks", async () => {
  const fixture = setup();
  const otherFixture = setup();
  const offsiteDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-import-boundaries-"),
  );
  const key = randomBytes(32);
  try {
    const localBackupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: localBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const replication = await createEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory: offsiteDirectory,
      keyId: "recovery-key-2026",
      masterKey: key,
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      sourceBackupDirectory: localBackupDirectory,
    });
    rmSync(dirname(snapshot.backupPath), { force: true, recursive: true });
    const options = {
      databasePath: fixture.databasePath,
      destinationDirectory: localBackupDirectory,
      masterKey: key,
      packageDirectory: replication.packageDirectory,
    } as const;

    await assert.rejects(
      importEncryptedReplication({ ...options, masterKey: randomBytes(32) }),
      /authenticate|authentication|unsupported state/iu,
    );
    await assert.rejects(
      importEncryptedReplication({
        ...options,
        destinationDirectory: replication.packageDirectory,
      }),
      /must not overlap/u,
    );

    const lockPath = join(
      localBackupDirectory,
      `automatic-backup-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}.lock`,
    );
    mkdirSync(localBackupDirectory, { recursive: true });
    writeFileSync(lockPath, "held", "utf8");
    await assert.rejects(importEncryptedReplication(options), /operation is in progress/u);
    rmSync(lockPath);

    await assert.rejects(
      importEncryptedReplication({
        databasePath: otherFixture.databasePath,
        destinationDirectory: join(otherFixture.directory, "backups"),
        masterKey: key,
        packageDirectory: replication.packageDirectory,
      }),
      /belongs to another active database/u,
    );
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(otherFixture.directory, { force: true, recursive: true });
    rmSync(offsiteDirectory, { force: true, recursive: true });
  }
});

test("scheduled off-device replication creates verified packages and reports append-only health", async () => {
  const fixture = setup();
  const offsiteDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-scheduled-"),
  );
  const key = randomBytes(32);
  try {
    const sourceBackupDirectory = join(fixture.directory, "backups");
    const firstSnapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const options = {
      databasePath: fixture.databasePath,
      destinationDirectory: offsiteDirectory,
      intervalHours: 24,
      keyId: "recovery-key-2026",
      masterKey: key,
      sourceBackupDirectory,
    } as const;
    const initial = getOffsiteReplicationStatus({
      ...options,
      now: new Date("2026-10-14T12:00:00.000Z"),
    });
    assert.equal(initial.health, "never_run");
    assert.equal(initial.due, true);
    assert.equal(initial.statePath, null);

    const first = await runOffsiteReplicationIfDue({
      ...options,
      now: new Date("2026-10-14T12:00:00.000Z"),
    });
    assert.equal(first.outcome, "replicated");
    assert.equal(first.status.health, "healthy");
    assert.equal(first.status.adapterId, "local-directory");
    assert.equal(first.status.adapterVersion, "1");
    assert.equal(first.status.formatVersion, 2);
    assert.equal(first.status.due, false);
    assert.equal(
      first.status.lastSnapshotDirectory,
      basename(dirname(firstSnapshot.backupPath)),
    );
    assert.equal(first.status.lastKeyId, "recovery-key-2026");
    assert.match(first.status.destinationIdentity, /^[a-f0-9]{64}$/u);
    assert.equal(existsSync(first.status.statePath ?? ""), true);
    assert.equal(first.replication?.verification.passed, true);
    assert.equal(existsSync(first.publication?.receiptPath ?? ""), true);
    assert.equal(first.publication?.adapterId, "local-directory");
    assert.equal(first.publication?.artifacts.length, 5);
    assert.equal(
      first.publication?.packageReference,
      first.replication?.packageDirectory,
    );
    const verificationReports = readdirSync(
      first.replication?.packageDirectory ?? "",
    ).filter((filename) => filename.startsWith("verification-"));
    assert.equal(verificationReports.length, 2);
    for (const filename of verificationReports) {
      const report = JSON.parse(
        readFileSync(
          join(first.replication?.packageDirectory ?? "", filename),
          "utf8",
        ),
      ) as { reportPath: string };
      assert.equal(
        report.reportPath,
        join(first.replication?.packageDirectory ?? "", filename),
      );
    }
    assert.equal(
      readFileSync(first.status.statePath ?? "", "utf8").includes(
        key.toString("base64"),
      ),
      false,
    );
    assert.equal(
      readFileSync(first.publication?.receiptPath ?? "", "utf8").includes(
        key.toString("base64"),
      ),
      false,
    );
    await assert.rejects(
      runOffsiteReplicationIfDue({
        ...options,
        masterKey: Buffer.alloc(31),
        now: new Date("2026-10-14T13:00:00.000Z"),
      }),
      /exactly 32 bytes/u,
    );

    const early = await runOffsiteReplicationIfDue({
      ...options,
      now: new Date("2026-10-14T13:00:00.000Z"),
    });
    assert.equal(early.outcome, "not_due");
    assert.equal(
      readdirSync(offsiteDirectory).filter((entry) => entry.startsWith("offsite-"))
        .length,
      1,
    );

    const secondSnapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-15T12:00:00.000Z"),
    });
    const second = await runOffsiteReplicationIfDue({
      ...options,
      now: new Date("2026-10-15T13:00:00.000Z"),
    });
    assert.equal(second.outcome, "replicated");
    assert.equal(second.status.sequence, 2);
    assert.equal(
      second.status.lastSnapshotDirectory,
      basename(dirname(secondSnapshot.backupPath)),
    );
    assert.equal(
      readdirSync(dirname(second.status.statePath ?? "")).filter((entry) =>
        entry.endsWith(".json"),
      ).length,
      2,
    );
    assert.equal(
      readdirSync(offsiteDirectory).filter((entry) => entry.startsWith("offsite-"))
        .length,
      2,
    );
    const publicationReceiptDirectory = readdirSync(sourceBackupDirectory).find(
      (entry) => entry.startsWith(".offsite-destination-receipts-"),
    );
    assert.notEqual(publicationReceiptDirectory, undefined);
    assert.equal(
      readdirSync(
        join(sourceBackupDirectory, publicationReceiptDirectory ?? ""),
      ).length,
      2,
    );
    rmSync(second.status.lastPackageDirectory ?? "", {
      force: true,
      recursive: true,
    });
    const unavailable = getOffsiteReplicationStatus({
      ...options,
      now: new Date("2026-10-15T14:00:00.000Z"),
    });
    assert.equal(unavailable.destinationAvailable, true);
    assert.equal(unavailable.lastPackageAvailable, false);
    assert.equal(unavailable.health, "unavailable");
    assert.equal(unavailable.due, true);
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(offsiteDirectory, { force: true, recursive: true });
  }
});

test("replication destination configuration is explicit, strict, and secret-free", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-adapter-config-"));
  const destinationDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-adapter-config-destination-"),
  );
  try {
    const configurationPath = join(directory, "destination.json");
    writeFileSync(
      configurationPath,
      `${JSON.stringify(
        {
          adapterId: "local-directory",
          destinationDirectory,
          formatVersion: 1,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const configuration = loadReplicationDestinationConfiguration(
      configurationPath,
    );
    assert.deepEqual(configuration, {
      adapterId: "local-directory",
      destinationDirectory: resolve(destinationDirectory),
      formatVersion: 1,
    });
    const adapter = createConfiguredReplicationDestinationAdapter(configuration);
    assert.equal(adapter.adapterId, "local-directory");
    assert.equal(adapter.adapterVersion, "1");
    assert.match(adapter.destinationIdentity, /^[a-f0-9]{64}$/u);

    assert.throws(
      () =>
        parseReplicationDestinationConfiguration({
          adapterId: "cloud-vendor",
          destinationDirectory,
          formatVersion: 1,
        }),
      /Unsupported replication destination adapter/u,
    );
    assert.throws(
      () =>
        parseReplicationDestinationConfiguration({
          adapterId: "local-directory",
          destinationDirectory: ".\\relative",
          formatVersion: 1,
        }),
      /must be a non-empty absolute path/u,
    );
    assert.throws(
      () =>
        parseReplicationDestinationConfiguration({
          adapterId: "local-directory",
          destinationDirectory,
          formatVersion: 1,
          key: "must-not-be-stored-here",
        }),
      /unsupported properties: key/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(destinationDirectory, { force: true, recursive: true });
  }
});

test("safeguard CLI selects a configured replication destination", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-adapter-cli-"));
  const destinationDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-adapter-cli-destination-"),
  );
  try {
    const configurationPath = join(directory, "destination.json");
    writeFileSync(
      configurationPath,
      JSON.stringify({
        adapterId: "local-directory",
        destinationDirectory,
        formatVersion: 1,
      }),
      "utf8",
    );
    const execution = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "safeguard.ts"),
        "offsite-status",
        "--database",
        join(directory, "memtextual.db"),
        "--source",
        directory,
        "--destination-config",
        configurationPath,
        "--interval-hours",
        "24",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(execution.status, 0, execution.stderr);
    const status = JSON.parse(execution.stdout) as {
      adapterId: string;
      adapterVersion: string;
      destinationAvailable: boolean;
    };
    assert.equal(status.adapterId, "local-directory");
    assert.equal(status.adapterVersion, "1");
    assert.equal(status.destinationAvailable, true);
  } finally {
    rmSync(directory, { force: true, recursive: true });
    rmSync(destinationDirectory, { force: true, recursive: true });
  }
});

test("safeguard CLI generates and validates a canonical recovery key without echoing it during validation", () => {
  const generated = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("src", "cli", "safeguard.ts"),
      "recovery-key-generate",
      "--key-id",
      "recovery-key-test-r2",
    ],
    { cwd: resolve("."), encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  const output = JSON.parse(generated.stdout) as {
    byteLength: number;
    canonicalBase64: string;
    keyId: string;
  };
  assert.equal(output.byteLength, 32);
  assert.match(output.canonicalBase64, /^[A-Za-z0-9+/]{43}=$/u);
  assert.equal(output.keyId, "recovery-key-test-r2");
  assert.match(generated.stderr, /secure password manager/u);

  const validated = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("src", "cli", "safeguard.ts"),
      "recovery-key-validate",
      "--key-env",
      "MEMTEXTUAL_TEST_RECOVERY_KEY",
      "--key-id",
      "recovery-key-test-r2",
    ],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        MEMTEXTUAL_TEST_RECOVERY_KEY: output.canonicalBase64,
      },
    },
  );
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(validated.stdout.includes(output.canonicalBase64), false);
  assert.deepEqual(JSON.parse(validated.stdout), {
    byteLength: 32,
    canonicalBase64: true,
    keyId: "recovery-key-test-r2",
    valid: true,
  });
});

test("off-device replication reads version 1 state as local-directory state", async () => {
  const fixture = setup();
  const offsiteDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-legacy-state-"),
  );
  const key = randomBytes(32);
  try {
    const sourceBackupDirectory = join(fixture.directory, "backups");
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const options = {
      databasePath: fixture.databasePath,
      destinationDirectory: offsiteDirectory,
      intervalHours: 24,
      keyId: "recovery-key-2026",
      masterKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      sourceBackupDirectory,
    } as const;
    const first = await runOffsiteReplicationIfDue(options);
    const statePath = first.status.statePath ?? "";
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    state.formatVersion = 1;
    delete state.adapterId;
    delete state.adapterVersion;
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const status = getOffsiteReplicationStatus({
      ...options,
      now: new Date("2026-10-14T13:00:00.000Z"),
    });
    assert.equal(status.adapterId, "local-directory");
    assert.equal(status.adapterVersion, "1");
    assert.equal(status.formatVersion, 2);
    assert.equal(status.health, "healthy");
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(offsiteDirectory, { force: true, recursive: true });
  }
});

test("scheduled off-device replication fails closed for unsafe state and newer corrupt recovery points", async () => {
  const fixture = setup();
  const offsiteDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-offsite-scheduled-failure-"),
  );
  const key = randomBytes(32);
  try {
    const sourceBackupDirectory = join(fixture.directory, "backups");
    await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const newer = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: sourceBackupDirectory,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    writeFileSync(newer.backupPath, "corrupted", "utf8");
    const options = {
      databasePath: fixture.databasePath,
      destinationDirectory: offsiteDirectory,
      intervalHours: 24,
      keyId: "recovery-key-2026",
      masterKey: key,
      now: new Date("2026-10-14T12:00:00.000Z"),
      sourceBackupDirectory,
    } as const;

    const neverMounted = getOffsiteReplicationStatus({
      ...options,
      destinationDirectory: join(offsiteDirectory, "missing"),
    });
    assert.equal(neverMounted.destinationAvailable, false);
    assert.equal(neverMounted.health, "unavailable");
    assert.equal(neverMounted.due, true);

    await assert.rejects(
      runOffsiteReplicationIfDue(options),
      /newer recovery point is protected and not verifiable/u,
    );
    const failed = getOffsiteReplicationStatus(options);
    assert.equal(failed.health, "failed");
    assert.equal(failed.due, true);
    assert.match(
      failed.lastFailure?.message ?? "",
      /newer recovery point is protected and not verifiable/u,
    );
    assert.equal(
      readdirSync(offsiteDirectory).filter((entry) => entry.startsWith("offsite-"))
        .length,
      0,
    );

    await assert.rejects(
      runOffsiteReplicationIfDue({
        ...options,
        destinationDirectory: sourceBackupDirectory,
      }),
      /must not overlap/u,
    );
    assert.throws(
      () => getOffsiteReplicationStatus({ ...options, intervalHours: 8_761 }),
      /no more than 8760/u,
    );
    writeFileSync(failed.statePath ?? "", "not-json", "utf8");
    assert.throws(
      () => getOffsiteReplicationStatus(options),
      /state is not valid JSON/u,
    );

    const lockPath = join(
      sourceBackupDirectory,
      `offsite-replication-${databaseSafeguardIdentity(fixture.databasePath).slice(0, 16)}.lock`,
    );
    writeFileSync(lockPath, "held", "utf8");
    await assert.rejects(
      runOffsiteReplicationIfDue(options),
      /already in progress/u,
    );
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(offsiteDirectory, { force: true, recursive: true });
  }
});

test("replication destination contract publishes only verified encrypted artifacts with a receipt", async () => {
  const fixture = setup();
  const packageRoot = mkdtempSync(join(tmpdir(), "memtextual-adapter-source-"));
  const destination = mkdtempSync(
    join(tmpdir(), "memtextual-adapter-destination-"),
  );
  const key = randomBytes(32);
  try {
    const backupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: backupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const replication = await createEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory: packageRoot,
      keyId: "recovery-key-2026",
      masterKey: key,
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      sourceBackupDirectory: backupDirectory,
    });
    const receipt = await publishReplicationPackage({
      adapter: createLocalDirectoryReplicationAdapter(destination),
      now: new Date("2026-10-15T12:00:00.000Z"),
      packageDirectory: replication.packageDirectory,
      receiptDirectory: join(fixture.directory, "destination-receipts"),
    });

    assert.equal(receipt.adapterId, "local-directory");
    assert.equal(receipt.adapterVersion, "1");
    assert.equal(receipt.packageId, replication.manifest.packageId);
    assert.equal(receipt.artifacts.length, 5);
    assert.equal(existsSync(receipt.receiptPath), true);
    assert.equal(existsSync(receipt.packageReference), true);
    assert.equal(existsSync(join(receipt.packageReference, "memtextual.db")), false);
    assert.equal(
      readFileSync(receipt.receiptPath, "utf8").includes(key.toString("base64")),
      false,
    );
    const verified = await verifyEncryptedReplication({
      masterKey: key,
      packageDirectory: receipt.packageReference,
    });
    assert.equal(verified.passed, true);

    await assert.rejects(
      publishReplicationPackage({
        adapter: createLocalDirectoryReplicationAdapter(destination),
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /EEXIST/u,
    );
    assert.equal(existsSync(receipt.packageReference), true);
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(destination, { force: true, recursive: true });
  }
});

test("replication destination contract rejects malformed adapter evidence and unexpected artifacts", async () => {
  const fixture = setup();
  const packageRoot = mkdtempSync(
    join(tmpdir(), "memtextual-adapter-boundary-source-"),
  );
  const destination = mkdtempSync(
    join(tmpdir(), "memtextual-adapter-boundary-destination-"),
  );
  const key = randomBytes(32);
  try {
    const backupDirectory = join(fixture.directory, "backups");
    const snapshot = await createDatabaseSnapshot({
      databasePath: fixture.databasePath,
      outputDirectory: backupDirectory,
      now: new Date("2026-10-12T12:00:00.000Z"),
    });
    const replication = await createEncryptedReplication({
      databasePath: fixture.databasePath,
      destinationDirectory: packageRoot,
      keyId: "recovery-key-2026",
      masterKey: key,
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      sourceBackupDirectory: backupDirectory,
    });
    let rollbackCalled = false;
    const malformedAdapter: ReplicationDestinationAdapter = {
      adapterId: "test-malformed",
      adapterVersion: "1",
      destinationIdentity: "test-destination",
      async publishPackage(request) {
        return {
          artifacts: request.artifacts.map((artifact, index) => ({
            ...artifact,
            sha256: index === 0 ? "0".repeat(64) : artifact.sha256,
          })),
          packageReference: "test://published-package",
        };
      },
      async removePackage() {
        rollbackCalled = true;
      },
    };
    await assert.rejects(
      publishReplicationPackage({
        adapter: malformedAdapter,
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /does not prove byte-for-byte artifact parity/u,
    );
    assert.equal(rollbackCalled, true);
    assert.equal(
      readdirSync(join(fixture.directory, "destination-receipts")).length,
      0,
    );

    const sourceDatabasePath = join(replication.packageDirectory, "database.enc");
    const sourceDatabase = readFileSync(sourceDatabasePath);
    let mutationRollbackCalled = false;
    const mutatingAdapter: ReplicationDestinationAdapter = {
      adapterId: "test-mutating",
      adapterVersion: "1",
      destinationIdentity: "test-destination",
      async publishPackage(request) {
        writeFileSync(
          sourceDatabasePath,
          Buffer.concat([sourceDatabase, Buffer.from([0])]),
        );
        return {
          artifacts: request.artifacts,
          packageReference: "test://mutated-source",
        };
      },
      async removePackage() {
        mutationRollbackCalled = true;
      },
    };
    await assert.rejects(
      publishReplicationPackage({
        adapter: mutatingAdapter,
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /does not match its manifest/u,
    );
    assert.equal(mutationRollbackCalled, true);
    writeFileSync(sourceDatabasePath, sourceDatabase);

    writeFileSync(join(replication.packageDirectory, "plaintext.db"), "unsafe");
    await assert.rejects(
      publishReplicationPackage({
        adapter: malformedAdapter,
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /missing or unexpected artifacts/u,
    );
    rmSync(join(replication.packageDirectory, "plaintext.db"));

    const verificationFilename = readdirSync(replication.packageDirectory).find(
      (filename) => filename.startsWith("verification-"),
    );
    assert.notEqual(verificationFilename, undefined);
    const verificationPath = join(
      replication.packageDirectory,
      verificationFilename ?? "",
    );
    const verificationReport = readFileSync(verificationPath);
    rmSync(verificationPath);
    await assert.rejects(
      publishReplicationPackage({
        adapter: malformedAdapter,
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /missing or unexpected artifacts/u,
    );
    writeFileSync(verificationPath, verificationReport);

    const encryptedDatabasePath = join(
      replication.packageDirectory,
      "database.enc",
    );
    const encryptedDatabase = readFileSync(encryptedDatabasePath);
    const tamperedDatabase = Buffer.from(encryptedDatabase);
    tamperedDatabase[Math.floor(tamperedDatabase.length / 2)] =
      (tamperedDatabase[Math.floor(tamperedDatabase.length / 2)] ?? 0) ^ 1;
    writeFileSync(encryptedDatabasePath, tamperedDatabase);
    await assert.rejects(
      publishReplicationPackage({
        adapter: malformedAdapter,
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /does not match its manifest/u,
    );
    writeFileSync(encryptedDatabasePath, encryptedDatabase);

    const missingDestination = join(destination, "missing");
    await assert.rejects(
      publishReplicationPackage({
        adapter: createLocalDirectoryReplicationAdapter(missingDestination),
        packageDirectory: replication.packageDirectory,
        receiptDirectory: join(fixture.directory, "destination-receipts"),
      }),
      /Replication destination does not exist/u,
    );
    assert.equal(existsSync(missingDestination), false);
  } finally {
    key.fill(0);
    rmSync(fixture.directory, { force: true, recursive: true });
    rmSync(packageRoot, { force: true, recursive: true });
    rmSync(destination, { force: true, recursive: true });
  }
});
