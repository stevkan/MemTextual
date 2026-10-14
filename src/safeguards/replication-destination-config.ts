import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  createLocalDirectoryReplicationAdapter,
  type ReplicationDestinationAdapter,
} from "./replication-destination.js";

export const replicationDestinationConfigFormatVersion = 1 as const;

export interface LocalDirectoryReplicationDestinationConfiguration {
  adapterId: "local-directory";
  destinationDirectory: string;
  formatVersion: typeof replicationDestinationConfigFormatVersion;
}

export type ReplicationDestinationConfiguration =
  LocalDirectoryReplicationDestinationConfiguration;

const configurationKeys = new Set([
  "adapterId",
  "destinationDirectory",
  "formatVersion",
]);

export function parseReplicationDestinationConfiguration(
  value: unknown,
): ReplicationDestinationConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Replication destination configuration must be an object.");
  }
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).filter(
    (key) => !configurationKeys.has(key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Replication destination configuration contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (record.formatVersion !== replicationDestinationConfigFormatVersion) {
    throw new Error(
      `Replication destination configuration formatVersion must be ${replicationDestinationConfigFormatVersion}.`,
    );
  }
  if (record.adapterId !== "local-directory") {
    throw new Error(
      `Unsupported replication destination adapter: ${String(record.adapterId)}.`,
    );
  }
  if (
    typeof record.destinationDirectory !== "string" ||
    record.destinationDirectory.length === 0 ||
    record.destinationDirectory !== record.destinationDirectory.trim() ||
    !isAbsolute(record.destinationDirectory)
  ) {
    throw new Error(
      "Local-directory replication destination must be a non-empty absolute path.",
    );
  }
  return {
    adapterId: "local-directory",
    destinationDirectory: resolve(record.destinationDirectory),
    formatVersion: replicationDestinationConfigFormatVersion,
  };
}

export function loadReplicationDestinationConfiguration(
  configurationPath: string,
): ReplicationDestinationConfiguration {
  const path = resolve(configurationPath);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error("Replication destination configuration does not exist.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Replication destination configuration must be a direct regular file.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Replication destination configuration is not valid JSON.");
  }
  return parseReplicationDestinationConfiguration(value);
}

export function createConfiguredReplicationDestinationAdapter(
  configuration: ReplicationDestinationConfiguration,
): ReplicationDestinationAdapter {
  const parsed = parseReplicationDestinationConfiguration(configuration);
  return createLocalDirectoryReplicationAdapter(parsed.destinationDirectory);
}
