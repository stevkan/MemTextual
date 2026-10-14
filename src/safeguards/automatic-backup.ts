import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  createDatabaseSnapshot,
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type SnapshotResult,
} from "./database-safeguard.js";

export const automaticBackupStateFormatVersion = 1 as const;

export type AutomaticBackupHealth =
  | "never_run"
  | "healthy"
  | "overdue"
  | "failed";

export interface AutomaticBackupState {
  formatVersion: typeof automaticBackupStateFormatVersion;
  sequence: number;
  databaseFile: string;
  intervalHours: number;
  lastAttemptAt: string | null;
  lastSuccessfulAt: string | null;
  lastVerifiedAt: string | null;
  lastSnapshotDirectory: string | null;
  lastFailure: {
    occurredAt: string;
    message: string;
  } | null;
}

export interface AutomaticBackupStatus extends AutomaticBackupState {
  due: boolean;
  health: AutomaticBackupHealth;
  nextDueAt: string | null;
  statePath: string | null;
}

export interface AutomaticBackupOptions {
  databasePath: string;
  outputDirectory: string;
  intervalHours: number;
  now?: Date;
}

export interface AutomaticBackupRunResult {
  outcome: "created" | "not_due";
  snapshot?: SnapshotResult;
  status: AutomaticBackupStatus;
}

interface ResolvedAutomaticBackupOptions {
  databasePath: string;
  outputDirectory: string;
  intervalHours: number;
  now: Date;
  stateDirectory: string;
  statePrefix: string;
  lockPath: string;
}

function validateIntervalHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 24) {
    throw new Error(
      "Automatic backup intervalHours must be greater than 0 and no more than 24.",
    );
  }
  return value;
}

function stateIdentity(databasePath: string): string {
  return databaseSafeguardIdentity(databasePath).slice(0, 16);
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function resolveOptions(
  options: AutomaticBackupOptions,
): ResolvedAutomaticBackupOptions {
  const databasePath = resolve(options.databasePath);
  const outputDirectory = resolve(options.outputDirectory);
  if (dirname(databasePath) === outputDirectory) {
    throw new Error(
      "The automatic backup destination must differ from the active database directory.",
    );
  }
  if (isWithin(outputDirectory, databasePath)) {
    throw new Error("The active database may not be stored inside its backup destination.");
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Automatic backup now must be a valid date.");
  }
  const identity = stateIdentity(databasePath);
  return {
    databasePath,
    outputDirectory,
    intervalHours: validateIntervalHours(options.intervalHours),
    now,
    stateDirectory: join(outputDirectory, `.automatic-backup-state-${identity}`),
    statePrefix: "state-",
    lockPath: join(outputDirectory, `automatic-backup-${identity}.lock`),
  };
}

function initialState(
  options: ResolvedAutomaticBackupOptions,
): AutomaticBackupState {
  return {
    formatVersion: automaticBackupStateFormatVersion,
    sequence: 0,
    databaseFile: basename(options.databasePath),
    intervalHours: options.intervalHours,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    lastVerifiedAt: null,
    lastSnapshotDirectory: null,
    lastFailure: null,
  };
}

function parseTimestamp(value: string | null, label: string): number | null {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Automatic backup state has an invalid ${label}.`);
  }
  return timestamp;
}

function readState(
  options: ResolvedAutomaticBackupOptions,
): { path: string | null; state: AutomaticBackupState } {
  let filenames: string[];
  try {
    filenames = readdirSync(options.stateDirectory)
      .filter(
        (filename) =>
          filename.startsWith(options.statePrefix) && filename.endsWith(".json"),
      )
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
  const statePath = join(options.stateDirectory, filename);
  let serialized: string;
  try {
    serialized = readFileSync(statePath, "utf8");
  } catch (error) {
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Automatic backup state is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Automatic backup state must be an object.");
  }
  const state = value as Partial<AutomaticBackupState>;
  if (
    state.formatVersion !== automaticBackupStateFormatVersion ||
    !Number.isSafeInteger(state.sequence) ||
    (state.sequence ?? 0) < 1 ||
    state.databaseFile !== basename(options.databasePath) ||
    typeof state.intervalHours !== "number" ||
    ![state.lastAttemptAt, state.lastSuccessfulAt, state.lastVerifiedAt].every(
      (entry) => entry === null || typeof entry === "string",
    ) ||
    (state.lastSnapshotDirectory !== null &&
      typeof state.lastSnapshotDirectory !== "string") ||
    (state.lastFailure !== null &&
      (typeof state.lastFailure !== "object" ||
        state.lastFailure === undefined ||
        typeof state.lastFailure.occurredAt !== "string" ||
        typeof state.lastFailure.message !== "string"))
  ) {
    throw new Error(
      "Automatic backup state is invalid or belongs to another database.",
    );
  }
  const sequence = state.sequence;
  if (sequence === undefined) {
    throw new Error("Automatic backup state sequence is missing.");
  }
  validateIntervalHours(state.intervalHours);
  parseTimestamp(state.lastAttemptAt ?? null, "lastAttemptAt");
  parseTimestamp(state.lastSuccessfulAt ?? null, "lastSuccessfulAt");
  parseTimestamp(state.lastVerifiedAt ?? null, "lastVerifiedAt");
  if (state.lastFailure !== null) {
    parseTimestamp(state.lastFailure.occurredAt, "lastFailure.occurredAt");
  }
  return {
    path: statePath,
    state: {
      formatVersion: automaticBackupStateFormatVersion,
      sequence,
      databaseFile: state.databaseFile,
      intervalHours: options.intervalHours,
      lastAttemptAt: state.lastAttemptAt ?? null,
      lastSuccessfulAt: state.lastSuccessfulAt ?? null,
      lastVerifiedAt: state.lastVerifiedAt ?? null,
      lastSnapshotDirectory: state.lastSnapshotDirectory ?? null,
      lastFailure: state.lastFailure ?? null,
    },
  };
}

function writeState(
  options: ResolvedAutomaticBackupOptions,
  state: AutomaticBackupState,
): string {
  mkdirSync(options.stateDirectory, { recursive: true });
  const sequence = state.sequence.toString().padStart(12, "0");
  const statePath = join(
    options.stateDirectory,
    `${options.statePrefix}${sequence}.json`,
  );
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return statePath;
}

function statusFromState(
  options: ResolvedAutomaticBackupOptions,
  state: AutomaticBackupState,
  statePath: string | null,
): AutomaticBackupStatus {
  const lastSuccessful = parseTimestamp(
    state.lastSuccessfulAt,
    "lastSuccessfulAt",
  );
  const nextDue =
    lastSuccessful === null
      ? null
      : lastSuccessful + options.intervalHours * 60 * 60 * 1_000;
  const due = nextDue === null || options.now.getTime() >= nextDue;
  const lastAttempt = parseTimestamp(state.lastAttemptAt, "lastAttemptAt");
  const failureAt =
    state.lastFailure === null
      ? null
      : parseTimestamp(state.lastFailure.occurredAt, "lastFailure.occurredAt");
  const failed =
    failureAt !== null &&
    (lastSuccessful === null || failureAt >= lastSuccessful) &&
    (lastAttempt === null || failureAt >= lastAttempt);
  const health: AutomaticBackupHealth = failed
    ? "failed"
    : lastSuccessful === null
      ? "never_run"
      : due
        ? "overdue"
        : "healthy";
  return {
    ...state,
    intervalHours: options.intervalHours,
    due,
    health,
    nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
    statePath,
  };
}

export function getAutomaticBackupStatus(
  options: AutomaticBackupOptions,
): AutomaticBackupStatus {
  const resolved = resolveOptions(options);
  const current = readState(resolved);
  return statusFromState(resolved, current.state, current.path);
}

export async function runAutomaticBackupIfDue(
  options: AutomaticBackupOptions,
): Promise<AutomaticBackupRunResult> {
  const resolved = resolveOptions(options);
  mkdirSync(resolved.outputDirectory, { recursive: true });
  let lock: number;
  try {
    lock = openSync(resolved.lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another automatic backup run is already in progress.");
    }
    throw error;
  }
  try {
    const currentRecord = readState(resolved);
    const current = currentRecord.state;
    const status = statusFromState(resolved, current, currentRecord.path);
    if (!status.due) {
      return { outcome: "not_due", status };
    }
    const attemptedAt = resolved.now.toISOString();
    try {
      const snapshot = await createDatabaseSnapshot({
        databasePath: resolved.databasePath,
        outputDirectory: resolved.outputDirectory,
        now: resolved.now,
      });
      const verification = verifyDatabaseAgainstManifest({
        databasePath: snapshot.backupPath,
        manifestPath: snapshot.manifestPath,
      });
      if (!verification.passed) {
        throw new Error(
          `New automatic backup verification failed: ${verification.problems.join("; ")}`,
        );
      }
      const successful: AutomaticBackupState = {
        formatVersion: automaticBackupStateFormatVersion,
        sequence: current.sequence + 1,
        databaseFile: basename(resolved.databasePath),
        intervalHours: resolved.intervalHours,
        lastAttemptAt: attemptedAt,
        lastSuccessfulAt: attemptedAt,
        lastVerifiedAt: attemptedAt,
        lastSnapshotDirectory: basename(dirname(snapshot.manifestPath)),
        lastFailure: null,
      };
      const statePath = writeState(resolved, successful);
      return {
        outcome: "created",
        snapshot,
        status: statusFromState(resolved, successful, statePath),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown backup failure";
      const failed: AutomaticBackupState = {
        ...current,
        sequence: current.sequence + 1,
        intervalHours: resolved.intervalHours,
        lastAttemptAt: attemptedAt,
        lastFailure: { occurredAt: attemptedAt, message },
      };
      writeState(resolved, failed);
      throw new Error(`Automatic backup failed: ${message}`);
    }
  } finally {
    closeSync(lock);
    rmSync(resolved.lockPath, { force: true });
  }
}
