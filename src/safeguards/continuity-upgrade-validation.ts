import Database from "better-sqlite3";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { applyMigrations } from "../database/sqlite-database.js";
import {
  createDatabaseSnapshot,
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type SnapshotResult,
} from "./database-safeguard.js";

export interface ContinuityUpgradeValidationReport {
  checkedTables: number;
  completedAt: string;
  fromMigrationVersion: number;
  liveDatabaseUnchanged: true;
  passed: true;
  snapshotDirectory: string;
  toMigrationVersion: number;
}

export interface ContinuityUpgradeValidationResult {
  report: ContinuityUpgradeValidationReport;
  reportPath: string;
  snapshot: SnapshotResult;
}

export interface ContinuityUpgradeValidationOptions {
  backupDirectory: string;
  databasePath: string;
  now?: Date;
  targetMigrationsDirectory: string;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function directPath(path: string, kind: "directory" | "file", label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}.`);
  }
  if (
    stats.isSymbolicLink() ||
    (kind === "directory" ? !stats.isDirectory() : !stats.isFile())
  ) {
    throw new Error(`${label} must be a direct ${kind}: ${path}.`);
  }
}

function migrationVersions(directory: string): number[] {
  directPath(directory, "directory", "Target migrations directory");
  const versions = readdirSync(directory)
    .map((filename) => filename.match(/^(\d+).*\.sql$/u)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseInt(value, 10))
    .sort((left, right) => left - right);
  if (versions.length === 0 || new Set(versions).size !== versions.length) {
    throw new Error("Target migrations must contain unique versioned SQL files.");
  }
  return versions;
}

function appliedVersions(databasePath: string): number[] {
  const database = new Database(databasePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    const table = database
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get();
    if (table === undefined) return [];
    return (
      database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all() as Array<{ version: number }>
    ).map(({ version }) => version);
  } finally {
    database.close();
  }
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function validateContinuityUpgrade(
  options: ContinuityUpgradeValidationOptions,
): Promise<ContinuityUpgradeValidationResult> {
  const databasePath = resolve(options.databasePath);
  const backupDirectory = resolve(options.backupDirectory);
  const targetMigrationsDirectory = resolve(options.targetMigrationsDirectory);
  directPath(databasePath, "file", "Continuity database");
  if (
    dirname(databasePath) === backupDirectory ||
    isWithin(backupDirectory, databasePath) ||
    isWithin(dirname(databasePath), backupDirectory)
  ) {
    throw new Error(
      "Upgrade backup directory must be separate from the active database directory.",
    );
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Upgrade validation time is invalid.");
  }
  const sourceVersions = appliedVersions(databasePath);
  const targetVersions = migrationVersions(targetMigrationsDirectory);
  if (
    sourceVersions.some((version, index) => targetVersions[index] !== version)
  ) {
    throw new Error(
      "Target migrations do not contain the active database migration history in order.",
    );
  }

  mkdirSync(backupDirectory, { recursive: true });
  directPath(backupDirectory, "directory", "Upgrade backup directory");
  const identity = databaseSafeguardIdentity(databasePath).slice(0, 16);
  const lockPath = join(backupDirectory, `automatic-backup-${identity}.lock`);
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another backup, restore, replication, or upgrade validation is in progress.");
    }
    throw error;
  }

  let snapshot: SnapshotResult | undefined;
  let disposableDirectory: string | undefined;
  try {
    snapshot = await createDatabaseSnapshot({
      databasePath,
      now,
      outputDirectory: backupDirectory,
    });
    disposableDirectory = mkdtempSync(join(backupDirectory, ".upgrade-validation-"));
    const disposableDatabase = join(disposableDirectory, basename(databasePath));
    copyFileSync(snapshot.backupPath, disposableDatabase, constants.COPYFILE_EXCL);
    const upgraded = new Database(disposableDatabase, { fileMustExist: true });
    try {
      upgraded.pragma("foreign_keys = ON");
      upgraded.pragma("busy_timeout = 5000");
      applyMigrations(upgraded, targetMigrationsDirectory);
      const integrity = upgraded.pragma("integrity_check") as Array<{
        integrity_check: string;
      }>;
      const message = integrity.map((row) => row.integrity_check).join("; ");
      if (message !== "ok") {
        throw new Error(`Disposable upgrade integrity check failed: ${message}`);
      }
      const foreignKeys = upgraded.pragma("foreign_key_check") as unknown[];
      if (foreignKeys.length > 0) {
        throw new Error(
          `Disposable upgrade has ${foreignKeys.length} foreign-key violation(s).`,
        );
      }
    } finally {
      upgraded.close();
    }
    const upgradedVersions = appliedVersions(disposableDatabase);
    if (!sameNumbers(upgradedVersions, targetVersions)) {
      throw new Error(
        "Disposable database migration history does not match the target application.",
      );
    }
    const preservation = verifyDatabaseAgainstManifest({
      databasePath: disposableDatabase,
      manifestPath: snapshot.manifestPath,
    });
    if (!preservation.passed) {
      throw new Error(
        `Disposable upgrade changed protected data: ${preservation.problems.join("; ")}`,
      );
    }
    const livePreservation = verifyDatabaseAgainstManifest({
      databasePath,
      manifestPath: snapshot.manifestPath,
    });
    if (!livePreservation.passed || !sameNumbers(appliedVersions(databasePath), sourceVersions)) {
      throw new Error(
        "The active database changed during upgrade validation; stop active writers and retry.",
      );
    }
    const completedAt = new Date().toISOString();
    const report: ContinuityUpgradeValidationReport = {
      checkedTables: preservation.checkedTables,
      completedAt,
      fromMigrationVersion: sourceVersions.at(-1) ?? 0,
      liveDatabaseUnchanged: true,
      passed: true,
      snapshotDirectory: basename(dirname(snapshot.backupPath)),
      toMigrationVersion: upgradedVersions.at(-1) ?? 0,
    };
    const reportPath = join(dirname(snapshot.backupPath), "upgrade-validation-report.json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return { report, reportPath, snapshot };
  } catch (error) {
    if (snapshot !== undefined) {
      const failurePath = join(
        dirname(snapshot.backupPath),
        "upgrade-validation-failure.json",
      );
      writeFileSync(
        failurePath,
        `${JSON.stringify(
          {
            failedAt: new Date().toISOString(),
            formatVersion: 1,
            message: error instanceof Error ? error.message : "Unknown upgrade validation failure",
            passed: false,
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    throw error;
  } finally {
    if (disposableDirectory !== undefined && existsSync(disposableDirectory)) {
      rmSync(disposableDirectory, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}
