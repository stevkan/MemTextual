import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { catalogDatabaseSnapshots } from "./backup-retention.js";
import {
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
} from "./database-safeguard.js";

export const restoreDrillStateFormatVersion = 1 as const;
export const restoreDrillReportFormatVersion = 1 as const;

export type RestoreDrillHealth =
  | "never_run"
  | "healthy"
  | "overdue"
  | "failed";

export interface RestoreDrillState {
  databaseFile: string;
  formatVersion: typeof restoreDrillStateFormatVersion;
  intervalHours: number;
  lastAttemptAt: string | null;
  lastFailure: { message: string; occurredAt: string } | null;
  lastReportPath: string | null;
  lastSnapshotDirectory: string | null;
  lastSuccessfulAt: string | null;
  sequence: number;
}

export interface RestoreDrillStatus extends RestoreDrillState {
  due: boolean;
  health: RestoreDrillHealth;
  nextDueAt: string | null;
  statePath: string | null;
}

export interface RestoreDrillReport {
  checkedTables: number;
  completedAt: string;
  databaseFile: string;
  disposableCopyRemoved: boolean;
  formatVersion: typeof restoreDrillReportFormatVersion;
  passed: boolean;
  problems: string[];
  protectedSnapshotCount: number;
  reportId: string;
  reportPath: string;
  snapshotDirectory: string | null;
  startedAt: string;
  verifiedSnapshotCount: number;
}

export interface RestoreDrillOptions {
  databasePath: string;
  intervalHours: number;
  now?: Date;
  outputDirectory: string;
}

export interface RestoreDrillRunResult {
  outcome: "performed" | "not_due";
  report?: RestoreDrillReport;
  status: RestoreDrillStatus;
}

interface ResolvedRestoreDrillOptions {
  databaseFile: string;
  databasePath: string;
  intervalHours: number;
  lockPath: string;
  now: Date;
  outputDirectory: string;
  reportDirectory: string;
  stateDirectory: string;
}

function validateIntervalHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 8_760) {
    throw new Error(
      "Restore drill intervalHours must be greater than 0 and no more than 8760.",
    );
  }
  return value;
}

function resolveOptions(options: RestoreDrillOptions): ResolvedRestoreDrillOptions {
  const databasePath = resolve(options.databasePath);
  const outputDirectory = resolve(options.outputDirectory);
  const identity = databaseSafeguardIdentity(databasePath).slice(0, 16);
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Restore drill now must be a valid date.");
  }
  return {
    databaseFile: basename(databasePath),
    databasePath,
    intervalHours: validateIntervalHours(options.intervalHours),
    lockPath: join(outputDirectory, `automatic-backup-${identity}.lock`),
    now,
    outputDirectory,
    reportDirectory: join(outputDirectory, `.restore-drill-reports-${identity}`),
    stateDirectory: join(outputDirectory, `.restore-drill-state-${identity}`),
  };
}

function initialState(options: ResolvedRestoreDrillOptions): RestoreDrillState {
  return {
    databaseFile: options.databaseFile,
    formatVersion: restoreDrillStateFormatVersion,
    intervalHours: options.intervalHours,
    lastAttemptAt: null,
    lastFailure: null,
    lastReportPath: null,
    lastSnapshotDirectory: null,
    lastSuccessfulAt: null,
    sequence: 0,
  };
}

function timestamp(value: string | null, label: string): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Restore drill state has an invalid ${label}.`);
  }
  return parsed;
}

function readState(
  options: ResolvedRestoreDrillOptions,
): { path: string | null; state: RestoreDrillState } {
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
    throw new Error("Restore drill state is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Restore drill state must be an object.");
  }
  const state = value as Partial<RestoreDrillState>;
  if (
    state.formatVersion !== restoreDrillStateFormatVersion ||
    state.databaseFile !== options.databaseFile ||
    !Number.isSafeInteger(state.sequence) ||
    (state.sequence ?? 0) < 1 ||
    typeof state.intervalHours !== "number" ||
    ![state.lastAttemptAt, state.lastSuccessfulAt].every(
      (entry) => entry === null || typeof entry === "string",
    ) ||
    (state.lastReportPath !== null && typeof state.lastReportPath !== "string") ||
    (state.lastSnapshotDirectory !== null &&
      typeof state.lastSnapshotDirectory !== "string") ||
    (state.lastFailure !== null &&
      (typeof state.lastFailure !== "object" ||
        state.lastFailure === undefined ||
        typeof state.lastFailure.message !== "string" ||
        typeof state.lastFailure.occurredAt !== "string"))
  ) {
    throw new Error("Restore drill state is invalid or belongs to another database.");
  }
  const sequence = state.sequence;
  if (sequence === undefined) {
    throw new Error("Restore drill state sequence is missing.");
  }
  validateIntervalHours(state.intervalHours);
  timestamp(state.lastAttemptAt ?? null, "lastAttemptAt");
  timestamp(state.lastSuccessfulAt ?? null, "lastSuccessfulAt");
  if (state.lastFailure !== null) {
    timestamp(state.lastFailure.occurredAt, "lastFailure.occurredAt");
  }
  return {
    path,
    state: {
      databaseFile: state.databaseFile,
      formatVersion: restoreDrillStateFormatVersion,
      intervalHours: options.intervalHours,
      lastAttemptAt: state.lastAttemptAt ?? null,
      lastFailure: state.lastFailure ?? null,
      lastReportPath: state.lastReportPath ?? null,
      lastSnapshotDirectory: state.lastSnapshotDirectory ?? null,
      lastSuccessfulAt: state.lastSuccessfulAt ?? null,
      sequence,
    },
  };
}

function writeState(
  options: ResolvedRestoreDrillOptions,
  state: RestoreDrillState,
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
  options: ResolvedRestoreDrillOptions,
  state: RestoreDrillState,
  statePath: string | null,
): RestoreDrillStatus {
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
  const due = failed || nextDue === null || options.now.getTime() >= nextDue;
  return {
    ...state,
    due,
    health: failed
      ? "failed"
      : success === null
        ? "never_run"
        : due
          ? "overdue"
          : "healthy",
    intervalHours: options.intervalHours,
    nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
    statePath,
  };
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeReport(
  options: ResolvedRestoreDrillOptions,
  input: Omit<RestoreDrillReport, "reportPath">,
): RestoreDrillReport {
  mkdirSync(options.reportDirectory, { recursive: true });
  const reportPath = join(
    options.reportDirectory,
    `${input.completedAt.replaceAll(":", "-")}-${input.reportId}.json`,
  );
  const report = { ...input, reportPath };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return report;
}

export function getRestoreDrillStatus(
  options: RestoreDrillOptions,
): RestoreDrillStatus {
  const resolved = resolveOptions(options);
  const current = readState(resolved);
  return statusFromState(resolved, current.state, current.path);
}

export function runRestoreDrillIfDue(
  options: RestoreDrillOptions,
): RestoreDrillRunResult {
  const resolved = resolveOptions(options);
  mkdirSync(resolved.outputDirectory, { recursive: true });
  let lock: number;
  try {
    lock = openSync(resolved.lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another backup, retention, or restore-drill operation is in progress.");
    }
    throw error;
  }
  try {
    const current = readState(resolved);
    const status = statusFromState(resolved, current.state, current.path);
    if (!status.due) {
      return { outcome: "not_due", status };
    }
    const startedAt = resolved.now.toISOString();
    const reportId = randomUUID();
    let snapshotDirectory: string | null = null;
    let disposableCopyRemoved = true;
    let protectedSnapshotCount = 0;
    let verifiedSnapshotCount = 0;
    try {
      const catalog = catalogDatabaseSnapshots({
        databasePath: resolved.databasePath,
        outputDirectory: resolved.outputDirectory,
        now: resolved.now,
      });
      protectedSnapshotCount = catalog.snapshots.filter(
        ({ decision }) => decision === "protect",
      ).length;
      verifiedSnapshotCount = catalog.verifiedSnapshots.length;
      const snapshot = catalog.verifiedSnapshots[0];
      if (snapshot === undefined) {
        throw new Error("No verified recovery point is available for a restore drill.");
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
      const workspace = mkdtempSync(join(tmpdir(), "memtextual-restore-drill-"));
      let verification: ReturnType<typeof verifyDatabaseAgainstManifest>;
      try {
        const restoredPath = join(workspace, "restored.db");
        copyFileSync(snapshot.backupPath, restoredPath);
        const manifest = JSON.parse(
          readFileSync(snapshot.manifestPath, "utf8"),
        ) as DatabaseSafeguardManifest;
        if (hashFile(restoredPath) !== manifest.backupSha256) {
          throw new Error("Disposable restored database hash does not match its manifest.");
        }
        verification = verifyDatabaseAgainstManifest({
          databasePath: restoredPath,
          manifestPath: snapshot.manifestPath,
        });
        if (!verification.passed) {
          throw new Error(
            `Disposable restore verification failed: ${verification.problems.join("; ")}`,
          );
        }
      } finally {
        try {
          rmSync(workspace, { force: true, recursive: true });
        } catch (error) {
          disposableCopyRemoved = false;
          throw error;
        }
      }
      const completedAt = startedAt;
      const report = writeReport(resolved, {
        checkedTables: verification.checkedTables,
        completedAt,
        databaseFile: resolved.databaseFile,
        disposableCopyRemoved,
        formatVersion: restoreDrillReportFormatVersion,
        passed: true,
        problems: [],
        protectedSnapshotCount,
        reportId,
        snapshotDirectory,
        startedAt,
        verifiedSnapshotCount,
      });
      const successful: RestoreDrillState = {
        databaseFile: resolved.databaseFile,
        formatVersion: restoreDrillStateFormatVersion,
        intervalHours: resolved.intervalHours,
        lastAttemptAt: startedAt,
        lastFailure: null,
        lastReportPath: report.reportPath,
        lastSnapshotDirectory: snapshotDirectory,
        lastSuccessfulAt: completedAt,
        sequence: current.state.sequence + 1,
      };
      const statePath = writeState(resolved, successful);
      return {
        outcome: "performed",
        report,
        status: statusFromState(resolved, successful, statePath),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown restore drill failure";
      const completedAt = startedAt;
      const report = writeReport(resolved, {
        checkedTables: 0,
        completedAt,
        databaseFile: resolved.databaseFile,
        disposableCopyRemoved,
        formatVersion: restoreDrillReportFormatVersion,
        passed: false,
        problems: [message],
        protectedSnapshotCount,
        reportId: randomUUID(),
        snapshotDirectory,
        startedAt,
        verifiedSnapshotCount,
      });
      const failed: RestoreDrillState = {
        ...current.state,
        intervalHours: resolved.intervalHours,
        lastAttemptAt: startedAt,
        lastFailure: { message, occurredAt: completedAt },
        lastReportPath: report.reportPath,
        lastSnapshotDirectory: snapshotDirectory,
        sequence: current.state.sequence + 1,
      };
      writeState(resolved, failed);
      throw new Error(`Restore drill failed: ${message}`);
    }
  } finally {
    closeSync(lock);
    rmSync(resolved.lockPath, { force: true });
  }
}
