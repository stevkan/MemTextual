import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { catalogDatabaseSnapshots } from "./backup-retention.js";
import { databaseSafeguardIdentity } from "./database-safeguard.js";
import {
  createEncryptedReplication,
  verifyEncryptedReplication,
  type EncryptedReplicationManifest,
  type EncryptedReplicationVerification,
} from "./encrypted-replication.js";
import {
  publishReplicationPackage,
  type ReplicationDestinationAdapter,
  type ReplicationDestinationArtifact,
  type ReplicationDestinationReceipt,
} from "./replication-destination.js";

export const scheduledReplicationStateFormatVersion = 1 as const;

export type ScheduledReplicationHealth =
  | "never_run"
  | "healthy"
  | "overdue"
  | "unavailable"
  | "failed";

export interface ScheduledReplicationState {
  adapterId: string;
  adapterVersion: string;
  databaseFile: string;
  destinationIdentity: string;
  formatVersion: typeof scheduledReplicationStateFormatVersion;
  intervalHours: number;
  lastArtifacts: ReplicationDestinationArtifact[] | null;
  lastAttemptAt: string | null;
  lastFailure: { message: string; occurredAt: string } | null;
  lastKeyId: string | null;
  lastPackageId: string | null;
  lastPackageName: string | null;
  lastPackageReference: string | null;
  lastSnapshotDirectory: string | null;
  lastSuccessfulAt: string | null;
  lastVerifiedAt: string | null;
  sequence: number;
}

export interface ScheduledReplicationStatus extends ScheduledReplicationState {
  destinationAvailable: boolean;
  due: boolean;
  health: ScheduledReplicationHealth;
  lastPackageAvailable: boolean | null;
  nextDueAt: string | null;
  statePath: string | null;
}

export interface ScheduledReplicationStatusOptions {
  adapter: ReplicationDestinationAdapter;
  databasePath: string;
  intervalHours: number;
  now?: Date;
  sourceBackupDirectory: string;
}

export interface ScheduledReplicationRunOptions
  extends ScheduledReplicationStatusOptions {
  keyId: string;
  masterKey: Uint8Array;
}

export interface ScheduledReplicationRunResult {
  manifest?: EncryptedReplicationManifest;
  outcome: "replicated" | "not_due";
  publication?: ReplicationDestinationReceipt;
  status: ScheduledReplicationStatus;
  verification?: EncryptedReplicationVerification;
}

interface ResolvedOptions {
  adapter: ReplicationDestinationAdapter;
  databaseFile: string;
  databasePath: string;
  intervalHours: number;
  lockPath: string;
  now: Date;
  receiptDirectory: string;
  sourceBackupDirectory: string;
  stateDirectory: string;
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateOptions(options: ScheduledReplicationStatusOptions): ResolvedOptions {
  const databasePath = resolve(options.databasePath);
  const sourceBackupDirectory = resolve(options.sourceBackupDirectory);
  const intervalHours = options.intervalHours;
  if (!Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours > 8_760) {
    throw new Error("Scheduled replication intervalHours must be greater than 0 and no more than 8760.");
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Scheduled replication now must be a valid date.");
  }
  safeId(options.adapter.adapterId, "Replication adapter id");
  safeId(options.adapter.adapterVersion, "Replication adapter version");
  if (!/^[a-f0-9]{64}$/u.test(options.adapter.destinationIdentity)) {
    throw new Error("Replication destination identity is invalid.");
  }
  if (
    options.adapter.destinationAvailable === undefined ||
    options.adapter.packageExists === undefined ||
    options.adapter.materializePackage === undefined
  ) {
    throw new Error("Scheduled replication adapter does not implement remote verification operations.");
  }
  const databaseIdentity = databaseSafeguardIdentity(databasePath);
  const stateIdentity = `${databaseIdentity.slice(0, 16)}-${options.adapter.destinationIdentity.slice(0, 16)}`;
  return {
    adapter: options.adapter,
    databaseFile: basename(databasePath),
    databasePath,
    intervalHours,
    lockPath: join(sourceBackupDirectory, `offsite-replication-${databaseIdentity.slice(0, 16)}.lock`),
    now,
    receiptDirectory: join(sourceBackupDirectory, `.scheduled-replication-receipts-${stateIdentity}`),
    sourceBackupDirectory,
    stateDirectory: join(sourceBackupDirectory, `.scheduled-replication-state-${stateIdentity}`),
  };
}

function initialState(options: ResolvedOptions): ScheduledReplicationState {
  return {
    adapterId: options.adapter.adapterId,
    adapterVersion: options.adapter.adapterVersion,
    databaseFile: options.databaseFile,
    destinationIdentity: options.adapter.destinationIdentity,
    formatVersion: scheduledReplicationStateFormatVersion,
    intervalHours: options.intervalHours,
    lastArtifacts: null,
    lastAttemptAt: null,
    lastFailure: null,
    lastKeyId: null,
    lastPackageId: null,
    lastPackageName: null,
    lastPackageReference: null,
    lastSnapshotDirectory: null,
    lastSuccessfulAt: null,
    lastVerifiedAt: null,
    sequence: 0,
  };
}

function parsedDate(value: string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Scheduled replication state has an invalid ${label}.`);
  return parsed;
}

function validArtifacts(value: unknown): value is ReplicationDestinationArtifact[] | null {
  return value === null || (Array.isArray(value) && value.length > 0 && value.every((artifact) =>
    typeof artifact === "object" && artifact !== null &&
    typeof artifact.filename === "string" && basename(artifact.filename) === artifact.filename &&
    Number.isSafeInteger(artifact.bytes) && artifact.bytes >= 0 &&
    typeof artifact.sha256 === "string" && /^[a-f0-9]{64}$/u.test(artifact.sha256)));
}

function readState(options: ResolvedOptions): { path: string | null; state: ScheduledReplicationState } {
  let filenames: string[];
  try {
    filenames = readdirSync(options.stateDirectory).filter((name) => /^state-\d{12}\.json$/u.test(name)).sort().reverse();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { path: null, state: initialState(options) };
    throw error;
  }
  const filename = filenames[0];
  if (filename === undefined) return { path: null, state: initialState(options) };
  const path = join(options.stateDirectory, filename);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Scheduled replication state is not valid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Scheduled replication state must be an object.");
  const state = value as ScheduledReplicationState;
  const nullable = (item: unknown): item is string | null => item === null || typeof item === "string";
  if (
    state.formatVersion !== scheduledReplicationStateFormatVersion ||
    state.adapterId !== options.adapter.adapterId || state.adapterVersion !== options.adapter.adapterVersion ||
    state.databaseFile !== options.databaseFile || state.destinationIdentity !== options.adapter.destinationIdentity ||
    !Number.isSafeInteger(state.sequence) || state.sequence < 1 || typeof state.intervalHours !== "number" ||
    !validArtifacts(state.lastArtifacts) || !nullable(state.lastAttemptAt) || !nullable(state.lastKeyId) ||
    !nullable(state.lastPackageId) || !nullable(state.lastPackageName) || !nullable(state.lastPackageReference) ||
    !nullable(state.lastSnapshotDirectory) || !nullable(state.lastSuccessfulAt) || !nullable(state.lastVerifiedAt) ||
    (state.lastFailure !== null && (typeof state.lastFailure !== "object" || typeof state.lastFailure.message !== "string" || typeof state.lastFailure.occurredAt !== "string"))
  ) throw new Error("Scheduled replication state is invalid or belongs to another destination.");
  parsedDate(state.lastAttemptAt, "lastAttemptAt"); parsedDate(state.lastSuccessfulAt, "lastSuccessfulAt"); parsedDate(state.lastVerifiedAt, "lastVerifiedAt");
  if (state.lastFailure !== null) parsedDate(state.lastFailure.occurredAt, "lastFailure.occurredAt");
  return { path, state: { ...state, intervalHours: options.intervalHours } };
}

function writeState(options: ResolvedOptions, state: ScheduledReplicationState): string {
  mkdirSync(options.stateDirectory, { recursive: true });
  const path = join(options.stateDirectory, `state-${state.sequence.toString().padStart(12, "0")}.json`);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return path;
}

async function statusFromState(options: ResolvedOptions, state: ScheduledReplicationState, statePath: string | null): Promise<ScheduledReplicationStatus> {
  const success = parsedDate(state.lastSuccessfulAt, "lastSuccessfulAt");
  const nextDue = success === null ? null : success + options.intervalHours * 3_600_000;
  const failed = state.lastFailure !== null && (success === null || parsedDate(state.lastFailure.occurredAt, "lastFailure.occurredAt")! >= success);
  const destinationAvailable = await options.adapter.destinationAvailable!();
  let lastPackageAvailable: boolean | null = null;
  if (state.lastPackageName !== null && state.lastArtifacts !== null) {
    if (!destinationAvailable) {
      lastPackageAvailable = false;
    } else {
      try {
        lastPackageAvailable = await options.adapter.packageExists!({
          artifacts: state.lastArtifacts,
          packageName: state.lastPackageName,
        });
      } catch {
        lastPackageAvailable = false;
      }
    }
  }
  const unavailable = !destinationAvailable || lastPackageAvailable === false;
  const due = failed || unavailable || nextDue === null || options.now.getTime() >= nextDue;
  const health: ScheduledReplicationHealth = failed ? "failed" : unavailable ? "unavailable" : success === null ? "never_run" : due ? "overdue" : "healthy";
  return { ...state, destinationAvailable, due, health, intervalHours: options.intervalHours, lastPackageAvailable, nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(), statePath };
}

export async function getScheduledReplicationStatus(options: ScheduledReplicationStatusOptions): Promise<ScheduledReplicationStatus> {
  const resolved = validateOptions(options);
  const current = readState(resolved);
  return statusFromState(resolved, current.state, current.path);
}

export async function runScheduledReplicationIfDue(options: ScheduledReplicationRunOptions): Promise<ScheduledReplicationRunResult> {
  const resolved = validateOptions(options);
  const keyId = options.keyId.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId)) throw new Error("Scheduled replication keyId is invalid.");
  if (options.masterKey.byteLength !== 32) throw new Error("Scheduled replication masterKey must be exactly 32 bytes.");
  mkdirSync(resolved.sourceBackupDirectory, { recursive: true });
  let lock: number;
  try { lock = openSync(resolved.lockPath, "wx"); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new Error("Another off-device replication run is already in progress.");
    throw error;
  }
  try {
    const current = readState(resolved);
    const status = await statusFromState(resolved, current.state, current.path);
    if (!status.due) return { outcome: "not_due", status };
    const attemptedAt = resolved.now.toISOString();
    let snapshotDirectory: string | null = null;
    let publishedPackageName: string | null = null;
    let stagingRoot: string | null = null;
    let materializationRoot: string | null = null;
    try {
      const catalog = catalogDatabaseSnapshots({ databasePath: resolved.databasePath, outputDirectory: resolved.sourceBackupDirectory, now: resolved.now });
      const snapshot = catalog.verifiedSnapshots[0];
      if (snapshot === undefined) throw new Error("No verified recovery point is available for scheduled replication.");
      const unorderable = catalog.snapshots.find((candidate) => candidate.decision === "protect" && candidate.createdAt === null);
      if (unorderable !== undefined) throw new Error(`A recovery point has an unknown creation time and is protected: ${unorderable.directory}.`);
      const newer = catalog.snapshots.find((candidate) => candidate.decision === "protect" && candidate.createdAt !== null && candidate.createdAt > snapshot.createdAt);
      if (newer !== undefined) throw new Error(`A newer recovery point is protected and not verifiable: ${newer.directory}.`);
      snapshotDirectory = snapshot.directory;
      stagingRoot = mkdtempSync(join(tmpdir(), "memtextual-scheduled-publication-"));
      const staged = await createEncryptedReplication({ databasePath: resolved.databasePath, destinationDirectory: stagingRoot, keyId, masterKey: options.masterKey, now: resolved.now, requireNewestVerified: true, snapshotDirectory, sourceBackupDirectory: resolved.sourceBackupDirectory });
      const packageName = basename(staged.packageDirectory);
      writeFileSync(staged.verification.reportPath, `${JSON.stringify({ ...staged.verification, reportPath: `${resolved.adapter.adapterId}://${resolved.adapter.destinationIdentity}/${packageName}/${basename(staged.verification.reportPath)}` }, null, 2)}\n`, "utf8");
      const publication = await publishReplicationPackage({ adapter: resolved.adapter, now: resolved.now, packageDirectory: staged.packageDirectory, receiptDirectory: resolved.receiptDirectory });
      publishedPackageName = publication.packageName;
      rmSync(stagingRoot, { force: true, recursive: true }); stagingRoot = null;
      materializationRoot = mkdtempSync(join(tmpdir(), "memtextual-scheduled-verification-"));
      const materialized = await resolved.adapter.materializePackage!({ artifacts: publication.artifacts, destinationDirectory: materializationRoot, packageName: publication.packageName });
      const verification = await verifyEncryptedReplication({ masterKey: options.masterKey, now: resolved.now, packageDirectory: materialized.packageDirectory });
      rmSync(materializationRoot, { force: true, recursive: true }); materializationRoot = null;
      const successful: ScheduledReplicationState = { adapterId: resolved.adapter.adapterId, adapterVersion: resolved.adapter.adapterVersion, databaseFile: resolved.databaseFile, destinationIdentity: resolved.adapter.destinationIdentity, formatVersion: scheduledReplicationStateFormatVersion, intervalHours: resolved.intervalHours, lastArtifacts: publication.artifacts, lastAttemptAt: attemptedAt, lastFailure: null, lastKeyId: staged.manifest.keyId, lastPackageId: staged.manifest.packageId, lastPackageName: publication.packageName, lastPackageReference: publication.packageReference, lastSnapshotDirectory: staged.manifest.snapshotDirectory, lastSuccessfulAt: attemptedAt, lastVerifiedAt: verification.verifiedAt, sequence: current.state.sequence + 1 };
      const statePath = writeState(resolved, successful);
      return { manifest: staged.manifest, outcome: "replicated", publication, status: await statusFromState(resolved, successful, statePath), verification };
    } catch (error) {
      let message = error instanceof Error ? error.message : "Unknown scheduled replication failure";
      for (const root of [stagingRoot, materializationRoot]) if (root !== null) { try { rmSync(root, { force: true, recursive: true }); } catch (cleanupError) { message += ` Temporary-data cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : "unknown cleanup failure"}.`; } }
      if (publishedPackageName !== null) { try { await resolved.adapter.removePackage({ packageName: publishedPackageName }); } catch (rollbackError) { message += ` Published-package rollback failed: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}.`; } }
      const failed: ScheduledReplicationState = { ...current.state, intervalHours: resolved.intervalHours, lastAttemptAt: attemptedAt, lastFailure: { message, occurredAt: attemptedAt }, lastSnapshotDirectory: snapshotDirectory, sequence: current.state.sequence + 1 };
      try { writeState(resolved, failed); } catch (stateError) { throw new Error(`Scheduled replication failed and its failure state could not be written. Replication error: ${message}. State error: ${stateError instanceof Error ? stateError.message : "unknown state failure"}.`); }
      throw new Error(`Scheduled replication failed: ${message}`);
    }
  } finally { closeSync(lock); rmSync(resolved.lockPath, { force: true }); }
}
