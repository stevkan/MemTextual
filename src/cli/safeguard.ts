#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  createDatabaseSnapshot,
  verifyDatabaseAgainstManifest,
} from "../safeguards/database-safeguard.js";
import {
  getAutomaticBackupStatus,
  runAutomaticBackupIfDue,
} from "../safeguards/automatic-backup.js";
import {
  applyBackupRetention,
  previewBackupRetention,
  type BackupRetentionPolicy,
} from "../safeguards/backup-retention.js";
import {
  getRestoreDrillStatus,
  runRestoreDrillIfDue,
} from "../safeguards/restore-drill.js";
import {
  applyGuidedRestore,
  previewGuidedRestore,
} from "../safeguards/guided-restore.js";
import {
  createEncryptedReplication,
  importEncryptedReplication,
  verifyEncryptedReplication,
} from "../safeguards/encrypted-replication.js";
import {
  getOffsiteReplicationStatus,
  runOffsiteReplicationIfDue,
} from "../safeguards/offsite-replication.js";
import {
  loadReplicationDestinationConfiguration,
  type ReplicationDestinationConfiguration,
} from "../safeguards/replication-destination-config.js";

function usage(): string {
  return [
    "Usage:",
    "  memtextual-safeguard snapshot --database PATH --output DIRECTORY",
    "  memtextual-safeguard verify --database PATH --manifest PATH",
    "  memtextual-safeguard run-if-due --database PATH --output DIRECTORY --interval-hours HOURS",
    "  memtextual-safeguard status --database PATH --output DIRECTORY --interval-hours HOURS",
    "  memtextual-safeguard retention-preview --database PATH --output DIRECTORY --daily COUNT --weekly COUNT --monthly COUNT --time-zone ZONE --week-starts-on DAY",
    "  memtextual-safeguard retention-apply --database PATH --output DIRECTORY --daily COUNT --weekly COUNT --monthly COUNT --time-zone ZONE --week-starts-on DAY --confirm TOKEN",
    "  memtextual-safeguard restore-drill --database PATH --output DIRECTORY --interval-hours HOURS",
    "  memtextual-safeguard restore-drill-status --database PATH --output DIRECTORY --interval-hours HOURS",
    "  memtextual-safeguard restore-preview --database PATH --output DIRECTORY --snapshot DIRECTORY",
    "  memtextual-safeguard restore-apply --database PATH --output DIRECTORY --snapshot DIRECTORY --confirm TOKEN",
    "  memtextual-safeguard offsite-export --database PATH --source DIRECTORY --destination DIRECTORY --snapshot DIRECTORY --key-env NAME --key-id ID",
    "  memtextual-safeguard offsite-run-if-due --database PATH --source DIRECTORY (--adapter local-directory --destination DIRECTORY | --destination-config PATH) --interval-hours HOURS --key-env NAME --key-id ID",
    "  memtextual-safeguard offsite-status --database PATH --source DIRECTORY (--adapter local-directory --destination DIRECTORY | --destination-config PATH) --interval-hours HOURS",
    "  memtextual-safeguard offsite-verify --package DIRECTORY --key-env NAME",
    "  memtextual-safeguard offsite-import --database PATH --package DIRECTORY --destination DIRECTORY --key-env NAME",
  ].join("\n");
}

function integerOption(arguments_: string[], name: string): number {
  const value = Number(optionValue(arguments_, name));
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.\n\n${usage()}`);
  }
  return value;
}

function retentionPolicy(arguments_: string[]): BackupRetentionPolicy {
  return {
    dailyCount: integerOption(arguments_, "--daily"),
    weeklyCount: integerOption(arguments_, "--weekly"),
    monthlyCount: integerOption(arguments_, "--monthly"),
    timeZone: optionValue(arguments_, "--time-zone"),
    weekStartsOn: integerOption(arguments_, "--week-starts-on"),
  };
}

function numberOption(arguments_: string[], name: string): number {
  const value = Number(optionValue(arguments_, name));
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.\n\n${usage()}`);
  }
  return value;
}

function optionValue(arguments_: string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name} option.\n\n${usage()}`);
  }
  return value;
}

function optionalOptionValue(arguments_: string[], name: string): string | null {
  const index = arguments_.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.\n\n${usage()}`);
  }
  return value;
}

function replicationDestination(
  arguments_: string[],
): ReplicationDestinationConfiguration {
  const configurationPath = optionalOptionValue(
    arguments_,
    "--destination-config",
  );
  const adapterId = optionalOptionValue(arguments_, "--adapter");
  const destinationDirectory = optionalOptionValue(arguments_, "--destination");
  if (configurationPath !== null) {
    if (adapterId !== null || destinationDirectory !== null) {
      throw new Error(
        "--destination-config cannot be combined with --adapter or --destination.",
      );
    }
    return loadReplicationDestinationConfiguration(resolve(configurationPath));
  }
  if (adapterId !== null && adapterId !== "local-directory") {
    throw new Error(`Unsupported replication destination adapter: ${adapterId}.`);
  }
  if (destinationDirectory === null) {
    throw new Error(`Missing required --destination option.\n\n${usage()}`);
  }
  return {
    adapterId: "local-directory",
    destinationDirectory: resolve(destinationDirectory),
    formatVersion: 1,
  };
}

function encryptionKey(arguments_: string[]): Buffer {
  const environmentName = optionValue(arguments_, "--key-env");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(environmentName)) {
    throw new Error("--key-env must name one environment variable.");
  }
  const encoded = process.env[environmentName]?.trim();
  if (encoded === undefined || encoded.length === 0) {
    throw new Error(`Encryption key environment variable is not set: ${environmentName}.`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error(
      `Encryption key environment variable must contain canonical base64: ${environmentName}.`,
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error(
      `Encryption key environment variable must encode exactly 32 bytes: ${environmentName}.`,
    );
  }
  return key;
}

async function main(arguments_: string[]): Promise<void> {
  const command = arguments_[0];
  if (command === "snapshot") {
    const databasePath = resolve(optionValue(arguments_, "--database"));
    const outputDirectory = resolve(optionValue(arguments_, "--output"));
    const result = await createDatabaseSnapshot({ databasePath, outputDirectory });
    console.log(`Snapshot created: ${result.backupPath}`);
    console.log(`Manifest created: ${result.manifestPath}`);
    console.log(`Durable data export created: ${result.exportPath}`);
    console.log(
      `Protected tables recorded: ${Object.keys(result.manifest.protectedTables).length}`,
    );
    return;
  }

  if (command === "verify") {
    const databasePath = resolve(optionValue(arguments_, "--database"));
    const manifestPath = resolve(optionValue(arguments_, "--manifest"));
    const result = verifyDatabaseAgainstManifest({
      databasePath,
      manifestPath,
    });
    const verifiedAt = new Date().toISOString();
    const reportPath = join(
      dirname(manifestPath),
      `verification-report-${verifiedAt.replaceAll(":", "-").replace(".", "-")}.json`,
    );
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          ...result,
          database: basename(databasePath),
          manifest: basename(manifestPath),
          manifestSha256: createHash("sha256")
            .update(readFileSync(manifestPath))
            .digest("hex"),
          verifiedAt,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    if (!result.passed) {
      throw new Error(
        `Safeguard verification failed; report: ${reportPath}\n- ${result.problems.join("\n- ")}`,
      );
    }
    console.log(`Safeguard verification passed for ${result.checkedTables} tables.`);
    console.log(`Verification report created: ${reportPath}`);
    return;
  }

  if (command === "run-if-due") {
    const result = await runAutomaticBackupIfDue({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      intervalHours: numberOption(arguments_, "--interval-hours"),
    });
    console.log(JSON.stringify(result.status, null, 2));
    console.log(
      result.outcome === "created"
        ? "Automatic backup created and verified."
        : "Automatic backup is not due.",
    );
    return;
  }

  if (command === "status") {
    const status = getAutomaticBackupStatus({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      intervalHours: numberOption(arguments_, "--interval-hours"),
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === "retention-preview") {
    const preview = previewBackupRetention({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      policy: retentionPolicy(arguments_),
    });
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (command === "retention-apply") {
    const receipt = applyBackupRetention({
      confirmation: optionValue(arguments_, "--confirm"),
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      policy: retentionPolicy(arguments_),
    });
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  if (command === "restore-drill") {
    const result = runRestoreDrillIfDue({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      intervalHours: numberOption(arguments_, "--interval-hours"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "restore-drill-status") {
    const status = getRestoreDrillStatus({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      intervalHours: numberOption(arguments_, "--interval-hours"),
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === "restore-preview") {
    const preview = previewGuidedRestore({
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      snapshotDirectory: optionValue(arguments_, "--snapshot"),
    });
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (command === "restore-apply") {
    const result = await applyGuidedRestore({
      confirmation: optionValue(arguments_, "--confirm"),
      databasePath: resolve(optionValue(arguments_, "--database")),
      outputDirectory: resolve(optionValue(arguments_, "--output")),
      snapshotDirectory: optionValue(arguments_, "--snapshot"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "offsite-export") {
    const key = encryptionKey(arguments_);
    try {
      const result = await createEncryptedReplication({
        databasePath: resolve(optionValue(arguments_, "--database")),
        destinationDirectory: resolve(
          optionValue(arguments_, "--destination"),
        ),
        keyId: optionValue(arguments_, "--key-id"),
        masterKey: key,
        snapshotDirectory: optionValue(arguments_, "--snapshot"),
        sourceBackupDirectory: resolve(optionValue(arguments_, "--source")),
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      key.fill(0);
    }
    return;
  }

  if (command === "offsite-run-if-due") {
    const destination = replicationDestination(arguments_);
    const key = encryptionKey(arguments_);
    try {
      const result = await runOffsiteReplicationIfDue({
        adapterId: destination.adapterId,
        databasePath: resolve(optionValue(arguments_, "--database")),
        destinationDirectory: destination.destinationDirectory,
        intervalHours: numberOption(arguments_, "--interval-hours"),
        keyId: optionValue(arguments_, "--key-id"),
        masterKey: key,
        sourceBackupDirectory: resolve(optionValue(arguments_, "--source")),
      });
      console.log(JSON.stringify(result.status, null, 2));
      console.log(
        result.outcome === "replicated"
          ? "Off-device recovery point created and verified."
          : "Off-device replication is not due.",
      );
    } finally {
      key.fill(0);
    }
    return;
  }

  if (command === "offsite-status") {
    const destination = replicationDestination(arguments_);
    const status = getOffsiteReplicationStatus({
      adapterId: destination.adapterId,
      databasePath: resolve(optionValue(arguments_, "--database")),
      destinationDirectory: destination.destinationDirectory,
      intervalHours: numberOption(arguments_, "--interval-hours"),
      sourceBackupDirectory: resolve(optionValue(arguments_, "--source")),
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === "offsite-verify") {
    const key = encryptionKey(arguments_);
    try {
      const result = await verifyEncryptedReplication({
        masterKey: key,
        packageDirectory: resolve(optionValue(arguments_, "--package")),
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      key.fill(0);
    }
    return;
  }

  if (command === "offsite-import") {
    const key = encryptionKey(arguments_);
    try {
      const result = await importEncryptedReplication({
        databasePath: resolve(optionValue(arguments_, "--database")),
        destinationDirectory: resolve(
          optionValue(arguments_, "--destination"),
        ),
        masterKey: key,
        packageDirectory: resolve(optionValue(arguments_, "--package")),
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      key.fill(0);
    }
    return;
  }

  throw new Error(`Unknown or missing command.\n\n${usage()}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown safeguard error";
  console.error(`MemTextual safeguard failed: ${message}`);
  process.exitCode = 1;
});
