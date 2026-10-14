import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
} from "./database-safeguard.js";

export const backupRetentionReceiptFormatVersion = 1 as const;

export interface BackupRetentionPolicy {
  dailyCount: number;
  weeklyCount: number;
  monthlyCount: number;
  timeZone: string;
  weekStartsOn: number;
}

export type BackupRetentionDecision = "keep" | "delete" | "protect";

export interface BackupRetentionSnapshot {
  directory: string;
  createdAt: string | null;
  decision: BackupRetentionDecision;
  retainedBy: Array<"newest" | "daily" | "weekly" | "monthly">;
  problems: string[];
}

export interface BackupRetentionPreview {
  confirmation: string;
  databaseFile: string;
  deleteCount: number;
  generatedAt: string;
  keepCount: number;
  policy: BackupRetentionPolicy;
  protectCount: number;
  snapshots: BackupRetentionSnapshot[];
}

export interface BackupRetentionReceipt {
  appliedAt: string;
  databaseFile: string;
  deletedDirectories: string[];
  formatVersion: typeof backupRetentionReceiptFormatVersion;
  policy: BackupRetentionPolicy;
  receiptId: string;
  receiptPath: string;
}

export interface BackupRetentionOptions {
  databasePath: string;
  outputDirectory: string;
  policy: BackupRetentionPolicy;
  now?: Date;
}

export interface VerifiedBackupSnapshot {
  backupPath: string;
  createdAt: string;
  directory: string;
  manifestPath: string;
}

export interface BackupSnapshotCatalog {
  databaseFile: string;
  inspectedAt: string;
  snapshots: BackupRetentionSnapshot[];
  verifiedSnapshots: VerifiedBackupSnapshot[];
}

export interface BackupSnapshotCatalogOptions {
  databasePath: string;
  outputDirectory: string;
  now?: Date;
}

function boundedCount(value: number, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > 10_000) {
    throw new Error(`${label} must be an integer between ${minimum} and 10000.`);
  }
  return value;
}

function normalizePolicy(policy: BackupRetentionPolicy): BackupRetentionPolicy {
  const timeZone = policy.timeZone.trim();
  if (timeZone.length === 0) {
    throw new Error("Backup retention timeZone must not be empty.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Unsupported backup retention timeZone: ${timeZone}.`);
  }
  return {
    dailyCount: boundedCount(policy.dailyCount, "dailyCount", 1),
    weeklyCount: boundedCount(policy.weeklyCount, "weeklyCount", 0),
    monthlyCount: boundedCount(policy.monthlyCount, "monthlyCount", 0),
    timeZone,
    weekStartsOn: validateWeekStartsOn(policy.weekStartsOn),
  };
}

function validateWeekStartsOn(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new Error("weekStartsOn must be an integer between 0 and 6.");
  }
  return value;
}

interface LocalDateParts {
  day: number;
  month: number;
  year: number;
}

function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: "day" | "month" | "year"): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (part === undefined) {
      throw new Error(`Unable to resolve retention ${type} in ${timeZone}.`);
    }
    return Number.parseInt(part, 10);
  };
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateKey(parts: LocalDateParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function retentionBucket(
  createdAt: string,
  tier: "daily" | "weekly" | "monthly",
  policy: BackupRetentionPolicy,
): string {
  const parts = localDateParts(new Date(createdAt), policy.timeZone);
  if (tier === "daily") {
    return dateKey(parts);
  }
  if (tier === "monthly") {
    return `${parts.year.toString().padStart(4, "0")}-${parts.month
      .toString()
      .padStart(2, "0")}`;
  }
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const delta = (localDate.getUTCDay() - policy.weekStartsOn + 7) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - delta);
  return dateKey({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
  });
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isDirectRegularFile(path: string): boolean {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function snapshotDirectories(outputDirectory: string): string[] {
  if (!existsSync(outputDirectory)) {
    return [];
  }
  return readdirSync(outputDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        entry.name.startsWith("memtextual-"),
    )
    .map(({ name }) => name)
    .sort();
}

function inspectSnapshot(
  outputDirectory: string,
  directory: string,
  databaseFile: string,
  databaseIdentity: string,
  now: Date,
): { snapshot: BackupRetentionSnapshot; verified?: VerifiedBackupSnapshot } {
  const path = join(outputDirectory, directory);
  const manifestPath = join(path, "manifest.json");
  const exportPath = join(path, "durable-data-export.json");
  const problems: string[] = [];
  let manifest: DatabaseSafeguardManifest | null = null;
  if (!isDirectRegularFile(manifestPath)) {
    problems.push("Manifest is missing or is not a direct regular file.");
  } else {
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as DatabaseSafeguardManifest;
    } catch {
      problems.push("Manifest is not valid JSON.");
    }
  }
  let createdAt: string | null = null;
  if (manifest !== null) {
    if (manifest.formatVersion !== 1) {
      problems.push("Manifest format is unsupported.");
    }
    if (manifest.sourceDatabase !== databaseFile) {
      problems.push("Snapshot belongs to another database file.");
    }
    if (manifest.sourceDatabaseIdentity !== databaseIdentity) {
      problems.push("Snapshot database identity is missing or does not match.");
    }
    if (manifest.backupFile !== "memtextual.db") {
      problems.push("Manifest backup filename is invalid.");
    }
    const timestamp = Date.parse(manifest.createdAt);
    if (Number.isNaN(timestamp)) {
      problems.push("Manifest creation time is invalid.");
    } else {
      createdAt = new Date(timestamp).toISOString();
      if (timestamp > now.getTime()) {
        problems.push("Snapshot creation time is in the future.");
      }
      const expectedDirectory = `memtextual-${createdAt
        .replaceAll(":", "-")
        .replace(".", "-")}`;
      if (directory !== expectedDirectory) {
        problems.push("Snapshot directory does not match its manifest time.");
      }
    }
    const backupPath = join(path, "memtextual.db");
    if (!isDirectRegularFile(backupPath)) {
      problems.push("Database backup is missing or is not a direct regular file.");
    } else if (hashFile(backupPath) !== manifest.backupSha256) {
      problems.push("Database backup hash does not match its manifest.");
    }
    if (!isDirectRegularFile(exportPath)) {
      problems.push(
        "Durable-data export is missing or is not a direct regular file.",
      );
    }
    if (problems.length === 0) {
      try {
        const verification = verifyDatabaseAgainstManifest({
          databasePath: backupPath,
          manifestPath,
        });
        if (!verification.passed) {
          problems.push(...verification.problems);
        }
      } catch (error) {
        problems.push(
          error instanceof Error ? error.message : "Snapshot verification failed.",
        );
      }
    }
  }
  const snapshot: BackupRetentionSnapshot = {
    directory,
    createdAt,
    decision: problems.length === 0 ? "delete" : "protect",
    retainedBy: [],
    problems,
  };
  return problems.length === 0 && createdAt !== null
    ? {
        snapshot,
        verified: {
          backupPath: join(path, "memtextual.db"),
          createdAt,
          directory,
          manifestPath,
        },
      }
    : { snapshot };
}

function addTierRetention(
  snapshots: VerifiedBackupSnapshot[],
  retained: Map<string, Set<"newest" | "daily" | "weekly" | "monthly">>,
  tier: "daily" | "weekly" | "monthly",
  count: number,
  policy: BackupRetentionPolicy,
): void {
  const buckets = new Set<string>();
  for (const snapshot of snapshots) {
    const bucket = retentionBucket(snapshot.createdAt, tier, policy);
    if (buckets.has(bucket)) {
      continue;
    }
    if (buckets.size >= count) {
      break;
    }
    buckets.add(bucket);
    retained.get(snapshot.directory)?.add(tier);
  }
}

function confirmationFor(
  databaseFile: string,
  policy: BackupRetentionPolicy,
  snapshots: BackupRetentionSnapshot[],
): string {
  const deletions = snapshots
    .filter(({ decision }) => decision === "delete")
    .map(({ createdAt, directory }) => ({ createdAt, directory }));
  const digest = createHash("sha256")
    .update(JSON.stringify({ databaseFile, policy, deletions }), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `DELETE ${deletions.length} BACKUPS ${digest}`;
}

export function previewBackupRetention(
  options: BackupRetentionOptions,
): BackupRetentionPreview {
  const policy = normalizePolicy(options.policy);
  const catalog = catalogDatabaseSnapshots(options);
  const verified = catalog.verifiedSnapshots;
  const retained = new Map(
    verified.map(({ directory }) => [
      directory,
      new Set<"newest" | "daily" | "weekly" | "monthly">(),
    ]),
  );
  const newest = verified[0];
  if (newest !== undefined) {
    retained.get(newest.directory)?.add("newest");
  }
  addTierRetention(verified, retained, "daily", policy.dailyCount, policy);
  addTierRetention(verified, retained, "weekly", policy.weeklyCount, policy);
  addTierRetention(verified, retained, "monthly", policy.monthlyCount, policy);

  const snapshots = catalog.snapshots
    .map((snapshot) => {
      const directory = snapshot.directory;
      const retainedBy = [...(retained.get(directory) ?? [])];
      return {
        ...snapshot,
        decision:
          snapshot.decision === "protect" || retainedBy.length === 0
            ? snapshot.decision
            : ("keep" as const),
        retainedBy,
      };
    })
    .sort(
      (left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? "") ||
        right.directory.localeCompare(left.directory),
    );
  return {
    confirmation: confirmationFor(catalog.databaseFile, policy, snapshots),
    databaseFile: catalog.databaseFile,
    deleteCount: snapshots.filter(({ decision }) => decision === "delete").length,
    generatedAt: catalog.inspectedAt,
    keepCount: snapshots.filter(({ decision }) => decision === "keep").length,
    policy,
    protectCount: snapshots.filter(({ decision }) => decision === "protect").length,
    snapshots,
  };
}

export function catalogDatabaseSnapshots(
  options: BackupSnapshotCatalogOptions,
): BackupSnapshotCatalog {
  const outputDirectory = resolve(options.outputDirectory);
  const databasePath = resolve(options.databasePath);
  const databaseFile = basename(databasePath);
  const databaseIdentity = databaseSafeguardIdentity(databasePath);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Backup catalog now must be a valid date.");
  }
  const inspected = snapshotDirectories(outputDirectory).map((directory) =>
    inspectSnapshot(
      outputDirectory,
      directory,
      databaseFile,
      databaseIdentity,
      now,
    ),
  );
  return {
    databaseFile,
    inspectedAt: now.toISOString(),
    snapshots: inspected
      .map(({ snapshot }) => snapshot)
      .sort(
        (left, right) =>
          (right.createdAt ?? "").localeCompare(left.createdAt ?? "") ||
          right.directory.localeCompare(left.directory),
      ),
    verifiedSnapshots: inspected
      .flatMap(({ verified }) => (verified === undefined ? [] : [verified]))
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.directory.localeCompare(left.directory),
      ),
  };
}

function safeSnapshotPath(outputDirectory: string, directory: string): string {
  const path = resolve(outputDirectory, directory);
  const relativePath = relative(outputDirectory, path);
  if (
    dirname(path) !== outputDirectory ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    basename(path) !== directory ||
    !directory.startsWith("memtextual-")
  ) {
    throw new Error(`Unsafe backup-retention target: ${directory}.`);
  }
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Backup-retention target is not a direct directory: ${directory}.`);
  }
  return path;
}

export function applyBackupRetention(
  options: BackupRetentionOptions & { confirmation: string },
): BackupRetentionReceipt {
  const outputDirectory = resolve(options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const databasePath = resolve(options.databasePath);
  const identity = databaseSafeguardIdentity(databasePath).slice(0, 16);
  const lockPath = join(outputDirectory, `automatic-backup-${identity}.lock`);
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another backup or retention operation is already in progress.");
    }
    throw error;
  }
  try {
    const preview = previewBackupRetention(options);
    if (options.confirmation !== preview.confirmation) {
      throw new Error(
        "Backup retention confirmation does not match the current preview.",
      );
    }
    const deletions = preview.snapshots.filter(
      ({ decision }) => decision === "delete",
    );
    const paths = deletions.map(({ directory }) => ({
      directory,
      path: safeSnapshotPath(outputDirectory, directory),
    }));
    const appliedAt = (options.now ?? new Date()).toISOString();
    const receiptId = randomUUID();
    const receiptDirectory = join(outputDirectory, ".retention-receipts");
    mkdirSync(receiptDirectory, { recursive: true });
    const operationPath = join(receiptDirectory, `${receiptId}.planned.json`);
    writeFileSync(
      operationPath,
      `${JSON.stringify(
        {
          createdAt: appliedAt,
          databaseFile: preview.databaseFile,
          directories: paths.map(({ directory }) => directory),
          policy: preview.policy,
          receiptId,
          status: "planned",
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    for (const target of paths) {
      rmSync(target.path, { recursive: true });
    }
    const receiptPath = join(
      receiptDirectory,
      `${appliedAt.replaceAll(":", "-")}-${receiptId}.json`,
    );
    const receipt: BackupRetentionReceipt = {
      appliedAt,
      databaseFile: preview.databaseFile,
      deletedDirectories: paths.map(({ directory }) => directory),
      formatVersion: backupRetentionReceiptFormatVersion,
      policy: preview.policy,
      receiptId,
      receiptPath,
    };
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    rmSync(operationPath);
    return receipt;
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}
