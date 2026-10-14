import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ContainerClient } from "@azure/storage-blob";
import { createAzureBlobReplicationAdapter } from "./azure-blob-replication-destination.js";
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

export interface AzureBlobReplicationDestinationConfiguration {
  accountUrl: string;
  adapterId: "azure-blob";
  containerName: string;
  credentialId: string;
  formatVersion: typeof replicationDestinationConfigFormatVersion;
  prefix?: string;
}

export type ReplicationDestinationConfiguration =
  | AzureBlobReplicationDestinationConfiguration
  | LocalDirectoryReplicationDestinationConfiguration;

const commonConfigurationKeys = new Set([
  "adapterId",
  "formatVersion",
]);

const localDirectoryConfigurationKeys = new Set([
  ...commonConfigurationKeys,
  "destinationDirectory",
]);

const azureBlobConfigurationKeys = new Set([
  ...commonConfigurationKeys,
  "accountUrl",
  "containerName",
  "credentialId",
  "prefix",
]);

function rejectUnexpected(
  record: Record<string, unknown>,
  keys: Set<string>,
): void {
  const unexpected = Object.keys(record).filter((key) => !keys.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Replication destination configuration contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function parseAzureAccountUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Azure Blob accountUrl must be an HTTPS origin.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Azure Blob accountUrl must be an HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    value !== url.origin
  ) {
    throw new Error(
      "Azure Blob accountUrl must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  return url.origin;
}

function parseAzurePrefix(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some(
        (segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(segment),
      )
  ) {
    throw new Error(
      "Azure Blob prefix must contain only direct slash-separated safe segments.",
    );
  }
  return value;
}

export function parseReplicationDestinationConfiguration(
  value: unknown,
): ReplicationDestinationConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Replication destination configuration must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.formatVersion !== replicationDestinationConfigFormatVersion) {
    throw new Error(
      `Replication destination configuration formatVersion must be ${replicationDestinationConfigFormatVersion}.`,
    );
  }
  if (record.adapterId === "local-directory") {
    rejectUnexpected(record, localDirectoryConfigurationKeys);
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
  if (record.adapterId === "azure-blob") {
    rejectUnexpected(record, azureBlobConfigurationKeys);
    const accountUrl = parseAzureAccountUrl(record.accountUrl);
    if (
      typeof record.containerName !== "string" ||
      !/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/u.test(record.containerName)
    ) {
      throw new Error("Azure Blob containerName is invalid.");
    }
    if (
      typeof record.credentialId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(record.credentialId)
    ) {
      throw new Error("Azure Blob credentialId is invalid.");
    }
    const prefix = parseAzurePrefix(record.prefix);
    return {
      accountUrl,
      adapterId: "azure-blob",
      containerName: record.containerName,
      credentialId: record.credentialId,
      formatVersion: replicationDestinationConfigFormatVersion,
      ...(prefix === undefined ? {} : { prefix }),
    };
  }
  throw new Error(
    `Unsupported replication destination adapter: ${String(record.adapterId)}.`,
  );
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
  dependencies: { azureBlobContainerClient?: ContainerClient } = {},
): ReplicationDestinationAdapter {
  const parsed = parseReplicationDestinationConfiguration(configuration);
  if (parsed.adapterId === "local-directory") {
    return createLocalDirectoryReplicationAdapter(parsed.destinationDirectory);
  }
  const containerClient = dependencies.azureBlobContainerClient;
  if (containerClient === undefined) {
    throw new Error(
      "Azure Blob adapter requires an explicitly authorized container client.",
    );
  }
  const expectedUrl = `${parsed.accountUrl}/${parsed.containerName}`;
  if (containerClient.url.replace(/\/+$/u, "") !== expectedUrl) {
    throw new Error(
      "Azure Blob container client does not match the configured account and container.",
    );
  }
  return createAzureBlobReplicationAdapter({
    containerClient,
    ...(parsed.prefix === undefined ? {} : { prefix: parsed.prefix }),
  });
}
