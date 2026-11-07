import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { databaseSafeguardIdentity } from "./database-safeguard.js";
import type {
  ReplicationDestinationAdapter,
  ReplicationDestinationArtifact,
} from "./replication-destination.js";
import {
  getScheduledReplicationHistory,
  getScheduledReplicationStatus,
  type ScheduledReplicationState,
  type ScheduledReplicationStatusOptions,
} from "./scheduled-replication.js";

export interface ScheduledReplicationRetirementOptions
  extends ScheduledReplicationStatusOptions {
  legacyPackageName: string;
}

export interface ScheduledReplicationRetirementPackage {
  artifacts: ReplicationDestinationArtifact[];
  keyId: string;
  packageId: string;
  packageName: string;
  successfulAt: string;
  verifiedAt: string;
}

export interface ScheduledReplicationRetirementPreview {
  confirmation: string;
  destinationIdentity: string;
  legacy: ScheduledReplicationRetirementPackage;
  operation: "retire-offsite-package";
  replacement: ScheduledReplicationRetirementPackage;
}

export interface ScheduledReplicationRetirementResult
  extends ScheduledReplicationRetirementPreview {
  completedAt: string;
  receiptPath: string;
  retirementId: string;
}

function packageName(value: string): string {
  if (
    value !== value.trim() ||
    basename(value) !== value ||
    !/^offsite-[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new Error("Legacy replication package name is invalid.");
  }
  return value;
}

function packageFromState(
  state: ScheduledReplicationState,
  label: string,
): ScheduledReplicationRetirementPackage {
  if (
    state.lastArtifacts === null ||
    state.lastKeyId === null ||
    state.lastPackageId === null ||
    state.lastPackageName === null ||
    state.lastSuccessfulAt === null ||
    state.lastVerifiedAt === null
  ) {
    throw new Error(`${label} replication state is incomplete.`);
  }
  return {
    artifacts: state.lastArtifacts
      .map((artifact) => ({ ...artifact }))
      .sort((left, right) => left.filename.localeCompare(right.filename)),
    keyId: state.lastKeyId,
    packageId: state.lastPackageId,
    packageName: state.lastPackageName,
    successfulAt: state.lastSuccessfulAt,
    verifiedAt: state.lastVerifiedAt,
  };
}

function confirmationFor(input: {
  destinationIdentity: string;
  legacy: ScheduledReplicationRetirementPackage;
  replacement: ScheduledReplicationRetirementPackage;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
  return `RETIRE-OFFSITE-PACKAGE-${digest}`;
}

function requireRetirementAdapter(
  adapter: ReplicationDestinationAdapter,
): asserts adapter is ReplicationDestinationAdapter & {
  packageMatchesExactly: NonNullable<
    ReplicationDestinationAdapter["packageMatchesExactly"]
  >;
  retirePackage: NonNullable<ReplicationDestinationAdapter["retirePackage"]>;
} {
  if (
    adapter.retirePackage === undefined ||
    adapter.packageMatchesExactly === undefined
  ) {
    throw new Error(
      "Replication destination does not implement explicit package retirement.",
    );
  }
}

export async function previewScheduledReplicationRetirement(
  options: ScheduledReplicationRetirementOptions,
): Promise<ScheduledReplicationRetirementPreview> {
  requireRetirementAdapter(options.adapter);
  const legacyPackageName = packageName(options.legacyPackageName);
  const history = getScheduledReplicationHistory(options);
  const status = await getScheduledReplicationStatus(options);
  if (
    status.health === "failed" ||
    !status.destinationAvailable ||
    status.lastPackageAvailable !== true
  ) {
    throw new Error(
      "Replication retirement requires an available, successfully verified current package and no unresolved replication failure.",
    );
  }
  const replacement = packageFromState(status, "Replacement");
  if (replacement.packageName === legacyPackageName) {
    throw new Error("The current replacement package cannot be retired.");
  }
  const legacyEntry = [...history]
    .reverse()
    .find(({ state }) => state.lastPackageName === legacyPackageName);
  if (legacyEntry === undefined) {
    throw new Error(
      "Legacy replication package is not present in the append-only local history.",
    );
  }
  const legacy = packageFromState(legacyEntry.state, "Legacy");
  if (legacy.keyId === replacement.keyId) {
    throw new Error(
      "Replication retirement requires a newer package protected by a different recovery-key id.",
    );
  }
  if (Date.parse(replacement.successfulAt) <= Date.parse(legacy.successfulAt)) {
    throw new Error(
      "Replication retirement requires a newer successful replacement package.",
    );
  }
  const [legacyAvailable, replacementAvailable] = await Promise.all([
    options.adapter.packageMatchesExactly({
      artifacts: legacy.artifacts,
      packageId: legacy.packageId,
      packageName: legacy.packageName,
    }),
    options.adapter.packageMatchesExactly({
      artifacts: replacement.artifacts,
      packageId: replacement.packageId,
      packageName: replacement.packageName,
    }),
  ]);
  if (!legacyAvailable) {
    throw new Error(
      "Legacy replication package is missing or no longer matches its exact recorded inventory.",
    );
  }
  if (!replacementAvailable) {
    throw new Error(
      "Replacement replication package no longer matches its exact recorded inventory.",
    );
  }
  const preview = {
    destinationIdentity: status.destinationIdentity,
    legacy,
    operation: "retire-offsite-package" as const,
    replacement,
  };
  return { ...preview, confirmation: confirmationFor(preview) };
}

export async function applyScheduledReplicationRetirement(
  options: ScheduledReplicationRetirementOptions & { confirmation: string },
): Promise<ScheduledReplicationRetirementResult> {
  requireRetirementAdapter(options.adapter);
  const sourceBackupDirectory = resolve(options.sourceBackupDirectory);
  mkdirSync(sourceBackupDirectory, { recursive: true });
  const lockPath = join(
    sourceBackupDirectory,
    `offsite-replication-${databaseSafeguardIdentity(resolve(options.databasePath)).slice(0, 16)}.lock`,
  );
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another off-device replication operation is already in progress.");
    }
    throw error;
  }
  try {
    const preview = await previewScheduledReplicationRetirement(options);
    if (options.confirmation !== preview.confirmation) {
      throw new Error(
        "Replication retirement confirmation is missing, incorrect, or stale.",
      );
    }
    const history = getScheduledReplicationHistory(options);
    const current = history.at(-1);
    if (current === undefined) {
      throw new Error("Scheduled replication history is missing.");
    }
    const retirementId = randomUUID();
    const receiptDirectory = join(dirname(current.statePath), "retirements");
    mkdirSync(receiptDirectory, { recursive: true });
    const startedAt = (options.now ?? new Date()).toISOString();
    const stem = `retirement-${startedAt.replaceAll(":", "-").replace(".", "-")}-${retirementId}`;
    const intentPath = join(receiptDirectory, `${stem}-intent.json`);
    writeFileSync(
      intentPath,
      `${JSON.stringify({ ...preview, retirementId, startedAt }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await options.adapter.retirePackage({
      artifacts: preview.legacy.artifacts,
      packageId: preview.legacy.packageId,
      packageName: preview.legacy.packageName,
    });
    const [legacyStillAvailable, replacementStillAvailable] = await Promise.all([
      options.adapter.packageExists!({
        artifacts: preview.legacy.artifacts,
        packageName: preview.legacy.packageName,
      }),
      options.adapter.packageExists!({
        artifacts: preview.replacement.artifacts,
        packageName: preview.replacement.packageName,
      }),
    ]);
    if (legacyStillAvailable || !replacementStillAvailable) {
      throw new Error(
        "Replication retirement postcondition verification failed; inspect the destination and retained intent receipt.",
      );
    }
    const completedAt = (options.now ?? new Date()).toISOString();
    const receiptPath = join(receiptDirectory, `${stem}-completed.json`);
    const result: ScheduledReplicationRetirementResult = {
      ...preview,
      completedAt,
      receiptPath,
      retirementId,
    };
    writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return result;
  } finally {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}
