import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseContinuityUpgradeCliArguments } from "../src/cli/continuity-upgrade.js";
import {
  ContinuityOnboardingService,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  databaseSafeguardIdentity,
  openMemTextualDatabase,
  validateContinuityUpgrade,
} from "../src/index.js";

function copyMigrations(target: string, maximumVersion = 21): void {
  mkdirSync(target, { recursive: true });
  for (const filename of readdirSync(resolve("migrations"))) {
    const version = Number.parseInt(filename.match(/^(\d+)/u)?.[1] ?? "0", 10);
    if (version > 0 && version <= maximumVersion) {
      copyFileSync(resolve("migrations", filename), join(target, filename));
    }
  }
}

function fixture(): {
  backupDirectory: string;
  databasePath: string;
  oldMigrations: string;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "memtextual-upgrade-validation-"));
  const oldMigrations = join(root, "old-migrations");
  copyMigrations(oldMigrations, 20);
  const databasePath = join(root, "data", "memtextual.db");
  mkdirSync(join(root, "data"));
  const database = openMemTextualDatabase({
    filename: databasePath,
    migrationsDirectory: oldMigrations,
  });
  try {
    const memories = new SqliteMemoryRepository(database);
    const scope = memories.createScope({
      kind: "project",
      name: "Upgrade validation fixture",
    });
    memories.create({
      assertion: "This durable memory must survive an upgrade.",
      scopeId: scope.id,
      type: "fact",
    });
    new ContinuityOnboardingService(
      new SqlitePersonaRepository(database),
    ).setup({ personaName: "Skylar", userDisplayName: "Steve" });
  } finally {
    database.close();
  }
  return {
    backupDirectory: join(root, "backups"),
    databasePath,
    oldMigrations,
    root,
  };
}

describe("Continuity upgrade validation", () => {
  it("upgrades only a disposable copy and preserves the live schema-20 database", async () => {
    const setup = fixture();
    try {
      const result = await validateContinuityUpgrade({
        backupDirectory: setup.backupDirectory,
        databasePath: setup.databasePath,
        now: new Date("2027-02-01T00:00:00.000Z"),
        targetMigrationsDirectory: resolve("migrations"),
      });
      assert.equal(result.report.passed, true);
      assert.equal(result.report.fromMigrationVersion, 20);
      assert.equal(result.report.toMigrationVersion, 21);
      assert.equal(result.report.liveDatabaseUnchanged, true);
      assert.equal(
        readdirSync(setup.backupDirectory).some((name) =>
          name.startsWith(".upgrade-validation-"),
        ),
        false,
      );
      const live = openMemTextualDatabase({
        filename: setup.databasePath,
        readonly: true,
      });
      try {
        assert.equal(
          (
            live
              .prepare("SELECT max(version) AS version FROM schema_migrations")
              .get() as { version: number }
          ).version,
          20,
        );
        assert.equal(
          (
            live.prepare("SELECT count(*) AS count FROM continuity_personas").get() as {
              count: number;
            }
          ).count,
          1,
        );
      } finally {
        live.close();
      }
    } finally {
      rmSync(setup.root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
  });

  it("retains the verified snapshot and failure report when a migration loses data", async () => {
    const setup = fixture();
    const unsafeMigrations = join(setup.root, "unsafe-migrations");
    copyMigrations(unsafeMigrations);
    writeFileSync(
      join(unsafeMigrations, "022_unsafe_test.sql"),
      [
        "PRAGMA foreign_keys = ON;",
        "BEGIN IMMEDIATE;",
        "DELETE FROM memory_items;",
        "INSERT INTO schema_migrations(version, name) VALUES (22, 'unsafe_test');",
        "COMMIT;",
        "",
      ].join("\n"),
      "utf8",
    );
    try {
      await assert.rejects(
        validateContinuityUpgrade({
          backupDirectory: setup.backupDirectory,
          databasePath: setup.databasePath,
          now: new Date("2027-02-02T00:00:00.000Z"),
          targetMigrationsDirectory: unsafeMigrations,
        }),
        /changed protected data/u,
      );
      const snapshotDirectory = join(
        setup.backupDirectory,
        readdirSync(setup.backupDirectory).find((name) =>
          name.startsWith("memtextual-"),
        )!,
      );
      const failure = JSON.parse(
        readFileSync(
          join(snapshotDirectory, "upgrade-validation-failure.json"),
          "utf8",
        ),
      ) as { passed: boolean };
      assert.equal(failure.passed, false);
      assert.equal(readdirSync(snapshotDirectory).includes("memtextual.db"), true);
      const live = openMemTextualDatabase({
        filename: setup.databasePath,
        readonly: true,
      });
      try {
        assert.equal(
          (
            live.prepare("SELECT count(*) AS count FROM memory_items").get() as {
              count: number;
            }
          ).count,
          1,
        );
        assert.equal(
          (
            live
              .prepare("SELECT max(version) AS version FROM schema_migrations")
              .get() as { version: number }
          ).version,
          20,
        );
      } finally {
        live.close();
      }
    } finally {
      if (readdirSync(setup.backupDirectory).length > 0) {
        for (const entry of readdirSync(setup.backupDirectory)) {
          rmSync(join(setup.backupDirectory, entry), {
            force: true,
            maxRetries: 5,
            recursive: true,
            retryDelay: 100,
          });
        }
      }
      for (const path of [
        unsafeMigrations,
        setup.oldMigrations,
        setup.backupDirectory,
        join(setup.root, "data"),
        setup.root,
      ]) {
        rmSync(path, {
          force: true,
          maxRetries: 5,
          recursive: true,
          retryDelay: 100,
        });
      }
    }
  });

  it("refuses to overlap an active backup-family operation", async () => {
    const setup = fixture();
    mkdirSync(setup.backupDirectory);
    const identity = databaseSafeguardIdentity(setup.databasePath).slice(0, 16);
    writeFileSync(
      join(setup.backupDirectory, `automatic-backup-${identity}.lock`),
      "occupied\n",
      "utf8",
    );
    try {
      await assert.rejects(
        validateContinuityUpgrade({
          backupDirectory: setup.backupDirectory,
          databasePath: setup.databasePath,
          targetMigrationsDirectory: resolve("migrations"),
        }),
        /Another backup, restore, replication, or upgrade validation is in progress/u,
      );
      assert.equal(
        readdirSync(setup.backupDirectory).some((name) =>
          name.startsWith("memtextual-"),
        ),
        false,
      );
    } finally {
      rmSync(setup.root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
  });

  it("requires every explicit validation path", () => {
    assert.deepEqual(
      parseContinuityUpgradeCliArguments([
        "validate",
        "--database",
        "C:\\data\\memtextual.db",
        "--backup-directory",
        "D:\\backups",
        "--migrations",
        "C:\\application\\migrations",
      ]),
      {
        backupDirectory: "D:\\backups",
        databasePath: "C:\\data\\memtextual.db",
        migrationsDirectory: "C:\\application\\migrations",
      },
    );
    assert.throws(
      () => parseContinuityUpgradeCliArguments(["validate"]),
      /All validation paths are required/u,
    );
  });
});
