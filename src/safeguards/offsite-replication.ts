import { createHash } from "node:crypto";
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
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { catalogDatabaseSnapshots } from "./backup-retention.js";
import { databaseSafeguardIdentity } from "./database-safeguard.js";
import {
  createEncryptedReplication,
  type CreateEncryptedReplicationResult,
} from "./encrypted-replication.js";

export const offsiteReplicationStateFormatVersion = 1 as const;

export type OffsiteReplicationHealth =
  | "never_run"
  | "healthy"
  | "overdue"
  | "unavailable"
  | "failed";

export interface OffsiteReplicationState {
  databaseFile: string;
  destinationIdentity: string;
  formatVersion: typeof offsiteReplicationStateFormatVersion;
  intervalHours: number;
  lastAttemptAt: string | null;
  lastFailure: { message: string; occurredAt: string } | null;
  lastKeyId: string | null;
  lastPackageDirectory: string | null;
  lastPackageId: string | null;
  lastSnapshotDirectory: string | null;
  lastSuccessfulAt: string | null;
  lastVerifiedAt: string | null;
  sequence: number;
}

export interface OffsiteReplicationStatus extends OffsiteReplicationState {
  destinationAvailable: boolean;
  due: boolean;
  health: OffsiteReplicationHealth;
  lastPackageAvailable: boolean | null;
  nextDueAt: string | null;
  statePath: string | null;
}

export interface OffsiteReplicationStatusOptions {
  databasePath: string;
  destinationDirectory: string;
  intervalHours: number;
  now?: Date;
  sourceBackupDirectory: string;
}

export interface OffsiteReplicationRunOptions
  extends OffsiteReplicationStatusOptions {
  keyId: string;
  masterKey: Uint8Array;
}

export interface OffsiteReplicationRunResult {
  outcome: "replicated" | "not_due";
  replication?: CreateEncryptedReplicationResult;
  status: OffsiteReplicationStatus;
}

interface ResolvedOffsiteReplicationOptions {
  databaseFile: string;
  databasePath: string;
  destinationDirectory: string;
  destinationIdentity: string;
  intervalHours: number;
  lockPath: string;
  now: Date;
  sourceBackupDirectory: string;
  stateDirectory: string;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function validateIntervalHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8_760) {
    throw new Error(
      "Off-device replication intervalHours must be greater than 0 and no more than 8760.",
    );
  }
  return value;
}

function validateKeyId(value: string): string {
  const keyId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId)) {
    throw new Error(
      "Off-device replication keyId must use 1-64 letters, numbers, periods, underscores, or hyphens.",
    );
  }
  return keyId;
}

function identityForDestination(path: string): string {
  const stablePath = process.platform === "win32" ? path.toLowerCase() : path;
  return createHash("sha256").update(stablePath, "utf8").digest("hex");
}

function resolveOptions(
  options: OffsiteReplicationStatusOptions,
): ResolvedOffsiteReplicationOptions {
  const databasePath = resolve(options.databasePath);
  const sourceBackupDirectory = resolve(options.sourceBackupDirectory);
  const destinationDirectory = resolve(options.destinationDirectory);
  if (
    isWithin(sourceBackupDirectory, destinationDirectory) ||
    isWithin(destinationDirectory, sourceBackupDirectory)
  ) {
    throw new Error(
      "Off-device replication destination must not overlap the local backup destination.",
    );
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Off-device replication now must be a valid date.");
  }
  const databaseIdentity = databaseSafeguardIdentity(databasePath);
  const destinationIdentity = identityForDestination(destinationDirectory);
  const stateIdentity = `${databaseIdentity.slice(0, 16)}-${destinationIdentity.slice(0, 16)}`;
  return {
    databaseFile: basename(databasePath),
    databasePath,
    destinationDirectory,
    destinationIdentity,
    intervalHours: validateIntervalHours(options.intervalHours),
    lockPath: join(
      sourceBackupDirectory,
      `offsite-replication-${databaseIdentity.slice(0, 16)}.lock`,
    ),
    now,
    sourceBackupDirectory,
    stateDirectory: join(
      sourceBackupDirectory,
      `.offsite-replication-state-${stateIdentity}`,
    ),
  };
}

function initialState(
  options: ResolvedOffsiteReplicationOptions,
): OffsiteReplicationState {
  return {
    databaseFile: options.databaseFile,
    destinationIdentity: options.destinationIdentity,
    formatVersion: offsiteReplicationStateFormatVersion,
    intervalHours: options.intervalHours,
    lastAttemptAt: null,
    lastFailure: null,
    lastKeyId: null,
    lastPackageDirectory: null,
    lastPackageId: null,
    lastSnapshotDirectory: null,
    lastSuccessfulAt: null,
    lastVerifiedAt: null,
    sequence: 0,
  };
}

function timestamp(value: string | null, label: string): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Off-device replication state has an invalid ${label}.`);
  }
  return parsed;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function directDirectoryExists(path: string): boolean {
  try {
    if (!existsSync(path)) {
      return false;
    }
    const stats = lstatSync(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function requireDirectDirectory(path: string, label: string): void {
  if (!directDirectoryExists(path)) {
    throw new Error(`${label} must be an existing direct directory.`);
  }
}

function readState(
  options: ResolvedOffsiteReplicationOptions,
): { path: string | null; state: OffsiteReplicationState } {
  let filenames: string[];
  try {
    filenames = readdirSync(options.stateDirectory)
      .filter((filename) => /^state-\d{12}\.json$/u.test(filename))
      .sort()
      .reverse();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { path: null, state: initialState(options) };
    }
    throw error;
  }
  const filename = filenames[0];
  if (filename === undefined) {
    return { path: null, state: initialState(options) };
  }
  const path = join(options.stateDirectory, filename);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Off-device replication state is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Off-device replication state must be an object.");
  }
  const state = value as Partial<OffsiteReplicationState>;
  if (
    state.formatVersion !== offsiteReplicationStateFormatVersion ||
    state.databaseFile !== options.databaseFile ||
    state.destinationIdentity !== options.destinationIdentity ||
    !/^[a-f0-9]{64}$/u.test(state.destinationIdentity ?? "") ||
    !Number.isSafeInteger(state.sequence) ||
    (state.sequence ?? 0) < 1 ||
    typeof state.intervalHours !== "number" ||
    !nullableString(state.lastAttemptAt) ||
    !nullableString(state.lastKeyId) ||
    !nullableString(state.lastPackageDirectory) ||
    !nullableString(state.lastPackageId) ||
    !nullableString(state.lastSnapshotDirectory) ||
    !nullableString(state.lastSuccessfulAt) ||
    !nullableString(state.lastVerifiedAt) ||
    (state.lastKeyId !== null &&
      !/^[A-Za-z0-9._-]{1,64}$/u.test(state.lastKeyId)) ||
    (state.lastPackageDirectory !== null &&
      (resolve(state.lastPackageDirectory) !== state.lastPackageDirectory ||
        !isWithin(options.destinationDirectory, state.lastPackageDirectory))) ||
    (state.lastPackageId !== null &&
      !/^[a-f0-9-]{36}$/u.test(state.lastPackageId)) ||
    (state.lastSnapshotDirectory !== null &&
      (basename(state.lastSnapshotDirectory) !== state.lastSnapshotDirectory ||
        !state.lastSnapshotDirectory.startsWith("memtextual-"))) ||
    (state.lastFailure !== null &&
      (typeof state.lastFailure !== "object" ||
        state.lastFailure === undefined ||
        typeof state.lastFailure.message !== "string" ||
        typeof state.lastFailure.occurredAt !== "string"))
  ) {
    throw new Error(
      "Off-device replication state is invalid or belongs to another destination.",
    );
  }
  const sequence = state.sequence;
  if (sequence === undefined) {
    throw new Error("Off-device replication state sequence is missing.");
  }
  validateIntervalHours(state.intervalHours);
  timestamp(state.lastAttemptAt, "lastAttemptAt");
  timestamp(state.lastSuccessfulAt, "lastSuccessfulAt");
  timestamp(state.lastVerifiedAt, "lastVerifiedAt");
  if (state.lastFailure !== null) {
    timestamp(state.lastFailure.occurredAt, "lastFailure.occurredAt");
  }
  return {
    path,
    state: {
      databaseFile: state.databaseFile,
      destinationIdentity: state.destinationIdentity,
      formatVersion: offsiteReplicationStateFormatVersion,
      intervalHours: options.intervalHours,
      lastAttemptAt: state.lastAttemptAt,
      lastFailure: state.lastFailure,
      lastKeyId: state.lastKeyId,
      lastPackageDirectory: state.lastPackageDirectory,
      lastPackageId: state.lastPackageId,
      lastSnapshotDirectory: state.lastSnapshotDirectory,
      lastSuccessfulAt: state.lastSuccessfulAt,
      lastVerifiedAt: state.lastVerifiedAt,
      sequence,
    },
  };
}

function writeState(
  options: ResolvedOffsiteReplicationOptions,
  state: OffsiteReplicationState,
): string {
  mkdirSync(options.stateDirectory, { recursive: true });
  const path = join(
    options.stateDirectory,
    `state-${state.sequence.toString().padStart(12, "0")}.json`,
  );
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return path;
}

function statusFromState(
  options: ResolvedOffsiteReplicationOptions,
  state: OffsiteReplicationState,
  statePath: string | null,
): OffsiteReplicationStatus {
  const success = timestamp(state.lastSuccessfulAt, "lastSuccessfulAt");
  const nextDue =
    success === null
      ? null
      : success + options.intervalHours * 60 * 60 * 1_000;
  const failed =
    state.lastFailure !== null &&
    (success === null ||
      timestamp(state.lastFailure.occurredAt, "lastFailure.occurredAt")! >=
        success);
  const destinationAvailable = directDirectoryExists(
    options.destinationDirectory,
  );
  const lastPackageAvailable =
    state.lastPackageDirectory === null
      ? null
      : directDirectoryExists(state.lastPackageDirectory);
  const unavailable =
    !destinationAvailable || lastPackageAvailable === false;
  const due =
    failed || unavailable || nextDue === null || options.now.getTime() >= nextDue;
  let health: OffsiteReplicationHealth;
  if (failed) {
    health = "failed";
  } else if (unavailable) {
    health = "unavailable";
  } else if (success === null) {
    health = "never_run";
  } else if (due) {
    health = "overdue";
  } else {
    health = "healthy";
  }
  return {
    ...state,
    destinationAvailable,
    due,
    health,
    intervalHours: options.intervalHours,
    lastPackageAvailable,
    nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
    statePath,
  };
}

export function getOffsiteReplicationStatus(
  options: OffsiteReplicationStatusOptions,
): OffsiteReplicationStatus {
  const resolved = resolveOptions(options);
  const current = readState(resolved);
  return statusFromState(resolved, current.state, current.path);
}

export async function runOffsiteReplicationIfDue(
  options: OffsiteReplicationRunOptions,
): Promise<OffsiteReplicationRunResult> {
  const resolved = resolveOptions(options);
  const keyId = validateKeyId(options.keyId);
  if (options.masterKey.byteLength !== 32) {
    throw new Error("Off-device replication masterKey must be exactly 32 bytes.");
  }
  mkdirSync(resolved.sourceBackupDirectory, { recursive: true });
  requireDirectDirectory(
    resolved.sourceBackupDirectory,
    "Local backup destination",
  );
  let lock: number;
  try {
    lock = openSync(resolved.lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another off-device replication run is already in progress.");
    }
    throw error;
  }
  try {
    const current = readState(resolved);
    const status = statusFromState(resolved, current.state, current.path);
    if (!status.due) {
      return { outcome: "not_due", status };
    }
    const attemptedAt = resolved.now.toISOString();
    let snapshotDirectory: string | null = null;
    try {
      const catalog = catalogDatabaseSnapshots({
        databasePath: resolved.databasePath,
        outputDirectory: resolved.sourceBackupDirectory,
        now: resolved.now,
      });
      const snapshot = catalog.verifiedSnapshots[0];
      if (snapshot === undefined) {
        throw new Error(
          "No verified recovery point is available for off-device replication.",
        );
      }
      const unorderableProtected = catalog.snapshots.find(
        (candidate) =>
          candidate.decision === "protect" && candidate.createdAt === null,
      );
      if (unorderableProtected !== undefined) {
        throw new Error(
          `A recovery point has an unknown creation time and is protected: ${unorderableProtected.directory}.`,
        );
      }
      const newerProtected = catalog.snapshots.find(
        (candidate) =>
          candidate.decision === "protect" &&
          candidate.createdAt !== null &&
          candidate.createdAt > snapshot.createdAt,
      );
      if (newerProtected !== undefined) {
        throw new Error(
          `A newer recovery point is protected and not verifiable: ${newerProtected.directory}.`,
        );
      }
      snapshotDirectory = snapshot.directory;
      const replication = await createEncryptedReplication({
        databasePath: resolved.databasePath,
        destinationDirectory: resolved.destinationDirectory,
        keyId,
        masterKey: options.masterKey,
        now: resolved.now,
        requireNewestVerified: true,
        snapshotDirectory,
        sourceBackupDirectory: resolved.sourceBackupDirectory,
      });
      const successful: OffsiteReplicationState = {
        databaseFile: resolved.databaseFile,
        destinationIdentity: resolved.destinationIdentity,
        formatVersion: offsiteReplicationStateFormatVersion,
        intervalHours: resolved.intervalHours,
        lastAttemptAt: attemptedAt,
        lastFailure: null,
        lastKeyId: replication.manifest.keyId,
        lastPackageDirectory: replication.packageDirectory,
        lastPackageId: replication.manifest.packageId,
        lastSnapshotDirectory: replication.manifest.snapshotDirectory,
        lastSuccessfulAt: attemptedAt,
        lastVerifiedAt: replication.verification.verifiedAt,
        sequence: current.state.sequence + 1,
      };
      const statePath = writeState(resolved, successful);
      return {
        outcome: "replicated",
        replication,
        status: statusFromState(resolved, successful, statePath),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown replication failure";
      const failed: OffsiteReplicationState = {
        ...current.state,
        intervalHours: resolved.intervalHours,
        lastAttemptAt: attemptedAt,
        lastFailure: { message, occurredAt: attemptedAt },
        lastSnapshotDirectory: snapshotDirectory,
        sequence: current.state.sequence + 1,
      };
      try {
        writeState(resolved, failed);
      } catch (stateError) {
        throw new Error(
          `Off-device replication failed and its local failure state could not be written. Replication error: ${message}. State error: ${stateError instanceof Error ? stateError.message : "unknown state failure"}.`,
        );
      }
      throw new Error(`Off-device replication failed: ${message}`);
    }
  } finally {
    closeSync(lock);
    rmSync(resolved.lockPath, { force: true });
  }
}
