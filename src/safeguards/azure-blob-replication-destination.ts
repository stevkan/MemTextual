import { createHash } from "node:crypto";
import { createReadStream, lstatSync, mkdirSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { ContainerClient } from "@azure/storage-blob";
import type {
  ReplicationDestinationAdapter,
  ReplicationDestinationArtifact,
} from "./replication-destination.js";

export interface AzureBlobReplicationDestinationOptions {
  containerClient: ContainerClient;
  prefix?: string;
}

const permittedArtifactName = /^(?:database\.enc|durable-data-export\.enc|replication-manifest\.json|safeguard-manifest\.enc|verification-[A-Za-z0-9._-]+\.json)$/u;

function directName(value: string, label: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    basename(value) !== value ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${label} must be a direct name.`);
  }
  return value;
}

function normalizedPrefix(value: string | undefined): string {
  if (value === undefined || value === "") {
    return "";
  }
  if (
    value !== value.trim() ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(segment))
  ) {
    throw new Error(
      "Azure Blob replication prefix must contain only direct slash-separated safe segments.",
    );
  }
  return `${value}/`;
}

function stableContainerIdentity(containerClient: ContainerClient): string {
  let url: URL;
  try {
    url = new URL(containerClient.url);
  } catch {
    throw new Error("Azure Blob container client has an invalid URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Azure Blob container URL must be HTTPS and must not contain credentials, query parameters, or fragments.",
    );
  }
  return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/u, "")}`;
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

function safeArtifactPath(sourceDirectory: string, filename: string): string {
  const source = resolve(sourceDirectory);
  const path = resolve(join(source, filename));
  const relativePath = relative(source, path);
  if (
    relativePath !== filename ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Azure Blob replication artifact path is unsafe.");
  }
  requireDirectFile(path, `Replication artifact ${filename}`);
  return path;
}

async function measureDownload(
  stream: NodeJS.ReadableStream | undefined,
): Promise<{ bytes: number; sha256: string }> {
  if (stream === undefined || !(Symbol.asyncIterator in stream)) {
    throw new Error("Azure Blob download did not return a readable body.");
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += buffer.byteLength;
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function sameArtifact(
  expected: ReplicationDestinationArtifact,
  measured: { bytes: number; sha256: string },
): boolean {
  return expected.bytes === measured.bytes && expected.sha256 === measured.sha256;
}

export function createAzureBlobReplicationAdapter(
  options: AzureBlobReplicationDestinationOptions,
): ReplicationDestinationAdapter {
  const prefix = normalizedPrefix(options.prefix);
  const containerIdentity = stableContainerIdentity(options.containerClient);
  const destinationIdentity = createHash("sha256")
    .update(`${containerIdentity}\n${prefix}`, "utf8")
    .digest("hex");
  const publishedArtifacts = new Map<string, string[]>();

  async function removeBlobNames(blobNames: readonly string[]): Promise<void> {
    const failures: string[] = [];
    for (const blobName of [...blobNames].reverse()) {
      try {
        await options.containerClient
          .getBlockBlobClient(blobName)
          .deleteIfExists({ deleteSnapshots: "include" });
      } catch (error) {
        failures.push(
          `${blobName}: ${error instanceof Error ? error.message : "unknown deletion failure"}`,
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`Azure Blob rollback failed: ${failures.join("; ")}.`);
    }
  }

  return {
    adapterId: "azure-blob",
    adapterVersion: "1",
    destinationIdentity,
    async destinationAvailable() {
      try {
        return await options.containerClient.exists();
      } catch {
        return false;
      }
    },
    async publishPackage(request) {
      const packageName = directName(request.packageName, "Package name");
      if (!/^offsite-[A-Za-z0-9._-]+$/u.test(packageName)) {
        throw new Error("Azure Blob package name is invalid.");
      }
      if (!/^[a-f0-9-]{36}$/u.test(request.packageId)) {
        throw new Error("Azure Blob package id is invalid.");
      }
      if (request.artifacts.length === 0) {
        throw new Error("Azure Blob publication requires encrypted artifacts.");
      }
      const seen = new Set<string>();
      const planned = request.artifacts.map((artifact) => {
        const filename = directName(artifact.filename, "Artifact filename");
        if (!permittedArtifactName.test(filename) || seen.has(filename)) {
          throw new Error(`Azure Blob replication artifact is invalid: ${filename}.`);
        }
        seen.add(filename);
        if (
          !Number.isSafeInteger(artifact.bytes) ||
          artifact.bytes < 0 ||
          !/^[a-f0-9]{64}$/u.test(artifact.sha256)
        ) {
          throw new Error(`Azure Blob artifact evidence is invalid: ${filename}.`);
        }
        return {
          artifact,
          blobName: `${prefix}${packageName}/${filename}`,
          sourcePath: safeArtifactPath(request.sourceDirectory, filename),
        };
      });

      for (const item of planned) {
        if (await options.containerClient.getBlockBlobClient(item.blobName).exists()) {
          throw new Error(`Azure Blob package already exists: ${packageName}.`);
        }
      }

      const uploaded: string[] = [];
      try {
        for (const item of planned) {
          const client = options.containerClient.getBlockBlobClient(item.blobName);
          await client.uploadFile(item.sourcePath, {
            conditions: { ifNoneMatch: "*" },
            metadata: {
              memtextualartifact: item.artifact.filename,
              memtextualpackageid: request.packageId,
              memtextualsha256: item.artifact.sha256,
            },
          });
          uploaded.push(item.blobName);
        }

        const verified: ReplicationDestinationArtifact[] = [];
        for (const item of planned) {
          const download = await options.containerClient
            .getBlockBlobClient(item.blobName)
            .download();
          const measured = await measureDownload(download.readableStreamBody);
          if (!sameArtifact(item.artifact, measured)) {
            throw new Error(
              `Azure Blob artifact failed byte-for-byte verification: ${item.artifact.filename}.`,
            );
          }
          verified.push({ ...item.artifact });
        }
        publishedArtifacts.set(packageName, [...uploaded]);
        return {
          artifacts: verified,
          packageReference: `azure-blob://${destinationIdentity}/${prefix}${packageName}`,
        };
      } catch (error) {
        try {
          await removeBlobNames(uploaded);
        } catch (rollbackError) {
          throw new Error(
            `Azure Blob publication failed and rollback failed. Publication error: ${error instanceof Error ? error.message : "unknown publication failure"}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}.`,
          );
        }
        throw error;
      }
    },
    async removePackage({ packageName }) {
      const directPackageName = directName(packageName, "Package name");
      const blobNames = publishedArtifacts.get(directPackageName);
      if (blobNames === undefined) {
        throw new Error(
          "Azure Blob rollback is limited to a package published by this adapter instance.",
        );
      }
      await removeBlobNames(blobNames);
      publishedArtifacts.delete(directPackageName);
    },
    async packageExists(request) {
      const packageName = directName(request.packageName, "Package name");
      for (const artifact of request.artifacts) {
        const filename = directName(artifact.filename, "Artifact filename");
        if (!permittedArtifactName.test(filename)) {
          return false;
        }
        const exists = await options.containerClient
          .getBlockBlobClient(`${prefix}${packageName}/${filename}`)
          .exists();
        if (!exists) {
          return false;
        }
      }
      return request.artifacts.length > 0;
    },
    async materializePackage(request) {
      const packageName = directName(request.packageName, "Package name");
      const materializationRoot = resolve(request.destinationDirectory);
      let rootStats;
      try {
        rootStats = lstatSync(materializationRoot);
      } catch {
        throw new Error("Azure Blob materialization destination does not exist.");
      }
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
        throw new Error(
          "Azure Blob materialization destination must be a direct directory.",
        );
      }
      const packageDirectory = join(materializationRoot, packageName);
      let packageCreated = false;
      try {
        mkdirSync(packageDirectory);
        packageCreated = true;
        const downloaded: ReplicationDestinationArtifact[] = [];
        for (const artifact of request.artifacts) {
          const filename = directName(artifact.filename, "Artifact filename");
          if (!permittedArtifactName.test(filename)) {
            throw new Error(
              `Azure Blob replication artifact is invalid: ${filename}.`,
            );
          }
          const path = join(packageDirectory, filename);
          await options.containerClient
            .getBlockBlobClient(`${prefix}${packageName}/${filename}`)
            .downloadToFile(path);
          const hash = createHash("sha256");
          let bytes = 0;
          for await (const chunk of createReadStream(path)) {
            const buffer = chunk as Buffer;
            bytes += buffer.byteLength;
            hash.update(buffer);
          }
          const measured = { bytes, sha256: hash.digest("hex") };
          if (!sameArtifact(artifact, measured)) {
            throw new Error(
              `Azure Blob materialized artifact failed byte-for-byte verification: ${filename}.`,
            );
          }
          downloaded.push({ filename, ...measured });
        }
        return { artifacts: downloaded, packageDirectory };
      } catch (error) {
        if (packageCreated) {
          rmSync(packageDirectory, { force: true, recursive: true });
        }
        throw error;
      }
    },
  };
}
