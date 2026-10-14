import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { catalogDatabaseSnapshots } from "./backup-retention.js";
import {
  createDatabaseSnapshot,
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
} from "./database-safeguard.js";

export const guidedRestoreReportFormatVersion = 1 as const;

export interface GuidedRestoreOptions {
  databasePath: string;
  now?: Date;
  outputDirectory: string;
  snapshotDirectory: string;
}

export interface GuidedRestorePreview {
  confirmation: string;
  currentDatabaseContentSha256: string;
  databaseFile: string;
  newerVerifiedSnapshots: string[];
  previewedAt: string;
  selectedBackupSha256: string;
  selectedCreatedAt: string;
  selectedSnapshotDirectory: string;
  warnings: string[];
}

export interface GuidedRestoreReport {
  checkedTables: number;
  completedAt: string;
  databaseFile: string;
  formatVersion: typeof guidedRestoreReportFormatVersion;
  preRestoreSnapshotDirectory: string;
  reportId: string;
  reportPath: string;
  restoredDatabaseSha256: string;
  selectedCreatedAt: string;
  selectedSnapshotDirectory: string;
}

export interface GuidedRestoreResult {
  cleanupReceiptPath: string | null;
  preRestoreSnapshotDirectory: string;
  report: GuidedRestoreReport;
  rollbackDirectory: string | null;
  warnings: string[];
}

interface ResolvedGuidedRestoreOptions {
  databaseDirectory: string;
  databaseFile: string;
  databasePath: string;
  identity: string;
  lockPath: string;
  now: Date;
  outputDirectory: string;
  reportDirectory: string;
  snapshotDirectory: string;
}

interface SelectedSnapshot {
  backupPath: string;
  createdAt: string;
  directory: string;
  manifestPath: string;
  manifest: DatabaseSafeguardManifest;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function requireDirectFile(path: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
}

function resolveOptions(options: GuidedRestoreOptions): ResolvedGuidedRestoreOptions {
  const databasePath = resolve(options.databasePath);
  const databaseDirectory = dirname(databasePath);
  const outputDirectory = resolve(options.outputDirectory);
  if (databaseDirectory === outputDirectory) {
    throw new Error(
      "The restore backup destination must differ from the active database directory.",
    );
  }
  if (isWithin(outputDirectory, databasePath)) {
    throw new Error("The active database may not be stored inside its backup destination.");
  }
  requireDirectFile(databasePath, "The active database");
  const snapshotDirectory = options.snapshotDirectory.trim();
  if (
    snapshotDirectory.length === 0 ||
    basename(snapshotDirectory) !== snapshotDirectory ||
    snapshotDirectory === "." ||
    snapshotDirectory === ".." ||
    !snapshotDirectory.startsWith("memtextual-")
  ) {
    throw new Error("snapshotDirectory must name one direct MemTextual snapshot.");
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Guided restore now must be a valid date.");
  }
  const identity = databaseSafeguardIdentity(databasePath).slice(0, 16);
  return {
    databaseDirectory,
    databaseFile: basename(databasePath),
    databasePath,
    identity,
    lockPath: join(outputDirectory, `automatic-backup-${identity}.lock`),
    now,
    outputDirectory,
    reportDirectory: join(outputDirectory, `.restore-reports-${identity}`),
    snapshotDirectory,
  };
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function logicalDatabaseHash(path: string): string {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    database.pragma("query_only = ON");
    const integrity = database.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    const result = integrity.map((row) => row.integrity_check).join("; ");
    if (result !== "ok") {
      throw new Error(`Active database integrity check failed: ${result}`);
    }
    return createHash("sha256").update(database.serialize()).digest("hex");
  } finally {
    database.close();
  }
}

function selectedSnapshot(
  options: ResolvedGuidedRestoreOptions,
): { selected: SelectedSnapshot; newerVerifiedSnapshots: string[] } {
  const catalog = catalogDatabaseSnapshots({
    databasePath: options.databasePath,
    outputDirectory: options.outputDirectory,
    now: options.now,
  });
  const selected = catalog.verifiedSnapshots.find(
    ({ directory }) => directory === options.snapshotDirectory,
  );
  if (selected === undefined) {
    const inspected = catalog.snapshots.find(
      ({ directory }) => directory === options.snapshotDirectory,
    );
    if (inspected !== undefined) {
      throw new Error(
        `Selected recovery point is protected and not verifiable: ${inspected.problems.join("; ")}`,
      );
    }
    throw new Error("Selected recovery point does not exist in this backup destination.");
  }
  const manifest = JSON.parse(
    readFileSync(selected.manifestPath, "utf8"),
  ) as DatabaseSafeguardManifest;
  if (
    manifest.formatVersion !== 1 ||
    manifest.sourceDatabase !== options.databaseFile ||
    manifest.sourceDatabaseIdentity !==
      databaseSafeguardIdentity(options.databasePath) ||
    manifest.backupFile !== basename(selected.backupPath) ||
    manifest.createdAt !== selected.createdAt ||
    manifest.backupSha256 !== hashFile(selected.backupPath)
  ) {
    throw new Error("Selected recovery point changed during verification.");
  }
  const verification = verifyDatabaseAgainstManifest({
    databasePath: selected.backupPath,
    manifestPath: selected.manifestPath,
  });
  if (!verification.passed) {
    throw new Error(
      `Selected recovery point changed during verification: ${verification.problems.join("; ")}`,
    );
  }
  return {
    selected: { ...selected, manifest },
    newerVerifiedSnapshots: catalog.verifiedSnapshots
      .filter(({ createdAt }) => createdAt > selected.createdAt)
      .map(({ directory }) => directory),
  };
}

function confirmationFor(input: {
  currentDatabaseContentSha256: string;
  databaseFile: string;
  selectedBackupSha256: string;
  selectedSnapshotDirectory: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `RESTORE ${input.databaseFile} FROM ${input.selectedSnapshotDirectory} ${digest}`;
}

function previewResolved(options: ResolvedGuidedRestoreOptions): GuidedRestorePreview {
  const currentDatabaseContentSha256 = logicalDatabaseHash(options.databasePath);
  const { selected, newerVerifiedSnapshots } = selectedSnapshot(options);
  const warnings = [
    "The active database will be replaced with the selected recovery point.",
    "Changes made after the selected recovery point will not be present after restore.",
    "Stop every MemTextual process that can access the active database before applying.",
  ];
  if (newerVerifiedSnapshots.length > 0) {
    warnings.push(
      `${newerVerifiedSnapshots.length} newer verified recovery point(s) exist.`,
    );
  }
  return {
    confirmation: confirmationFor({
      currentDatabaseContentSha256,
      databaseFile: options.databaseFile,
      selectedBackupSha256: selected.manifest.backupSha256,
      selectedSnapshotDirectory: selected.directory,
    }),
    currentDatabaseContentSha256,
    databaseFile: options.databaseFile,
    newerVerifiedSnapshots,
    previewedAt: options.now.toISOString(),
    selectedBackupSha256: selected.manifest.backupSha256,
    selectedCreatedAt: selected.createdAt,
    selectedSnapshotDirectory: selected.directory,
    warnings,
  };
}

export function previewGuidedRestore(
  options: GuidedRestoreOptions,
): GuidedRestorePreview {
  return previewResolved(resolveOptions(options));
}

function assertExclusiveAccess(path: string): void {
  const database = new Database(path, { fileMustExist: true });
  database.pragma("busy_timeout = 1000");
  try {
    database.exec("BEGIN EXCLUSIVE");
    database.exec("ROLLBACK");
  } catch {
    throw new Error(
      "The active database is busy. Stop every MemTextual process before restoring.",
    );
  } finally {
    database.close();
  }
}

function writeJsonOnce(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function applyGuidedRestore(
  options: GuidedRestoreOptions & { confirmation: string },
): Promise<GuidedRestoreResult> {
  const resolved = resolveOptions(options);
  mkdirSync(resolved.outputDirectory, { recursive: true });
  let lock: number;
  try {
    lock = openSync(resolved.lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        "Another backup, retention, restore-drill, or restore operation is in progress.",
      );
    }
    throw error;
  }

  try {
    const preview = previewResolved(resolved);
    if (options.confirmation !== preview.confirmation) {
      throw new Error(
        "Guided restore confirmation does not match the current preview.",
      );
    }
    const selected = selectedSnapshot(resolved).selected;
    const operationId = randomUUID();
    const preRestore = await createDatabaseSnapshot({
      databasePath: resolved.databasePath,
      outputDirectory: resolved.outputDirectory,
      now: resolved.now,
    });
    const preRestoreVerification = verifyDatabaseAgainstManifest({
      databasePath: preRestore.backupPath,
      manifestPath: preRestore.manifestPath,
    });
    if (!preRestoreVerification.passed) {
      throw new Error(
        `Pre-restore recovery point verification failed: ${preRestoreVerification.problems.join("; ")}`,
      );
    }
    if (
      logicalDatabaseHash(resolved.databasePath) !==
      preview.currentDatabaseContentSha256
    ) {
      throw new Error(
        "The active database changed after preview; create a new restore preview.",
      );
    }

    const stagePath = join(
      resolved.databaseDirectory,
      `.${resolved.databaseFile}.restore-stage-${operationId}`,
    );
    const rollbackDirectory = join(
      resolved.databaseDirectory,
      `.${resolved.databaseFile}.restore-rollback-${operationId}`,
    );
    const plannedPath = join(
      resolved.reportDirectory,
      `${operationId}.planned.json`,
    );
    const copiedOriginals: Array<{ original: string; rollback: string }> = [];
    let activationStarted = false;
    try {
      copyFileSync(selected.backupPath, stagePath, constants.COPYFILE_EXCL);
      if (hashFile(stagePath) !== selected.manifest.backupSha256) {
        throw new Error("Staged restore database hash does not match its manifest.");
      }
      const stageVerification = verifyDatabaseAgainstManifest({
        databasePath: stagePath,
        manifestPath: selected.manifestPath,
      });
      if (!stageVerification.passed) {
        throw new Error(
          `Staged restore verification failed: ${stageVerification.problems.join("; ")}`,
        );
      }

      mkdirSync(resolved.reportDirectory, { recursive: true });
      mkdirSync(rollbackDirectory);
      writeJsonOnce(plannedPath, {
        createdAt: resolved.now.toISOString(),
        databaseFile: resolved.databaseFile,
        operationId,
        preRestoreSnapshotDirectory: basename(dirname(preRestore.backupPath)),
        rollbackDirectory,
        selectedSnapshotDirectory: selected.directory,
        stagePath,
        status: "planned",
      });

      const originalPaths = [
        resolved.databasePath,
        `${resolved.databasePath}-wal`,
        `${resolved.databasePath}-shm`,
        `${resolved.databasePath}-journal`,
      ].filter((path) => existsSync(path));
      for (const path of originalPaths) {
        requireDirectFile(path, `Restore source ${basename(path)}`);
      }
      assertExclusiveAccess(resolved.databasePath);
      if (
        logicalDatabaseHash(resolved.databasePath) !==
        preview.currentDatabaseContentSha256
      ) {
        throw new Error(
          "The active database changed before activation; create a new restore preview.",
        );
      }
      for (const original of originalPaths) {
        const rollback = join(rollbackDirectory, basename(original));
        copyFileSync(original, rollback, constants.COPYFILE_EXCL);
        copiedOriginals.push({ original, rollback });
      }
      activationStarted = true;
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        rmSync(`${resolved.databasePath}${suffix}`, { force: true });
      }
      copyFileSync(stagePath, resolved.databasePath);
      rmSync(stagePath, { force: true });

      if (hashFile(resolved.databasePath) !== selected.manifest.backupSha256) {
        throw new Error("Activated database hash does not match its manifest.");
      }
      const activeVerification = verifyDatabaseAgainstManifest({
        databasePath: resolved.databasePath,
        manifestPath: selected.manifestPath,
      });
      if (!activeVerification.passed) {
        throw new Error(
          `Activated restore verification failed: ${activeVerification.problems.join("; ")}`,
        );
      }

      const completedAt = resolved.now.toISOString();
      const reportPath = join(
        resolved.reportDirectory,
        `${completedAt.replaceAll(":", "-")}-${operationId}.json`,
      );
      const report: GuidedRestoreReport = {
        checkedTables: activeVerification.checkedTables,
        completedAt,
        databaseFile: resolved.databaseFile,
        formatVersion: guidedRestoreReportFormatVersion,
        preRestoreSnapshotDirectory: basename(dirname(preRestore.backupPath)),
        reportId: operationId,
        reportPath,
        restoredDatabaseSha256: selected.manifest.backupSha256,
        selectedCreatedAt: selected.createdAt,
        selectedSnapshotDirectory: selected.directory,
      };
      writeJsonOnce(reportPath, report);

      const warnings: string[] = [];
      let cleanupReceiptPath: string | null = null;
      let retainedRollbackDirectory: string | null = rollbackDirectory;
      try {
        rmSync(rollbackDirectory, { recursive: true });
        retainedRollbackDirectory = null;
        const receiptPath = join(
          resolved.reportDirectory,
          `${operationId}.cleanup.json`,
        );
        writeJsonOnce(receiptPath, {
          cleanedAt: completedAt,
          operationId,
          rollbackDirectory,
          status: "removed",
        });
        cleanupReceiptPath = receiptPath;
        rmSync(plannedPath);
      } catch (error) {
        warnings.push(
          `Restore succeeded, but post-restore cleanup evidence requires review: ${error instanceof Error ? error.message : "unknown cleanup failure"}`,
        );
      }
      return {
        cleanupReceiptPath,
        preRestoreSnapshotDirectory: report.preRestoreSnapshotDirectory,
        report,
        rollbackDirectory: retainedRollbackDirectory,
        warnings,
      };
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        if (activationStarted) {
          for (const suffix of ["-wal", "-shm", "-journal"]) {
            rmSync(`${resolved.databasePath}${suffix}`, { force: true });
          }
          for (const copied of copiedOriginals) {
            if (existsSync(copied.rollback)) {
              copyFileSync(copied.rollback, copied.original);
            }
          }
        }
        rmSync(stagePath, { force: true });
        rmSync(rollbackDirectory, { force: true, recursive: true });
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
      if (rollbackError !== null) {
        throw new Error(
          `Guided restore failed and automatic rollback also failed. Preserve the planned operation record for recovery. Restore error: ${error instanceof Error ? error.message : "unknown restore failure"}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}.`,
        );
      }
      const failureMessage =
        error instanceof Error ? error.message : "unknown restore failure";
      try {
        mkdirSync(resolved.reportDirectory, { recursive: true });
        writeJsonOnce(
          join(
            resolved.reportDirectory,
            `${resolved.now.toISOString().replaceAll(":", "-")}-${operationId}.failed.json`,
          ),
          {
            completedAt: resolved.now.toISOString(),
            databaseFile: resolved.databaseFile,
            error: failureMessage,
            formatVersion: guidedRestoreReportFormatVersion,
            operationId,
            preRestoreSnapshotDirectory: basename(dirname(preRestore.backupPath)),
            rollbackSucceeded: true,
            selectedSnapshotDirectory: selected.directory,
            status: "failed",
          },
        );
        rmSync(plannedPath, { force: true });
      } catch (reportError) {
        throw new Error(
          `Guided restore failed and the original database was restored, but its failure report could not be written. Preserve any planned operation record. Restore error: ${failureMessage}. Report error: ${reportError instanceof Error ? reportError.message : "unknown report failure"}.`,
        );
      }
      throw new Error(
        `Guided restore failed and the original database was left unchanged or restored: ${failureMessage}`,
      );
    }
  } finally {
    closeSync(lock);
    rmSync(resolved.lockPath, { force: true });
  }
}
