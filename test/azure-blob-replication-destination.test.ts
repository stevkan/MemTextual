import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import type { ContainerClient } from "@azure/storage-blob";

import { createAzureBlobReplicationAdapter } from "../src/safeguards/azure-blob-replication-destination.js";
import type { ReplicationDestinationArtifact } from "../src/safeguards/replication-destination.js";
import {
  createConfiguredReplicationDestinationAdapter,
  parseReplicationDestinationConfiguration,
} from "../src/safeguards/replication-destination-config.js";

interface StoredBlob {
  body: Buffer;
  etag: string;
  metadata: Record<string, string>;
}

class FakeAzureBlobContainer {
  readonly blobs = new Map<string, StoredBlob>();
  readonly url: string;
  available = true;
  tamperDownloads = false;

  constructor(url = "https://example.blob.core.windows.net/memtextual") {
    this.url = url;
  }

  getBlockBlobClient(blobName: string) {
    return {
      deleteIfExists: async (options?: { conditions?: { ifMatch?: string } }) => {
        const stored = this.blobs.get(blobName);
        if (
          stored !== undefined &&
          options?.conditions?.ifMatch !== undefined &&
          options.conditions.ifMatch !== stored.etag
        ) {
          throw new Error("ConditionNotMet");
        }
        return { succeeded: this.blobs.delete(blobName) };
      },
      download: async () => {
        const stored = this.blobs.get(blobName);
        if (stored === undefined) {
          throw new Error("Blob does not exist.");
        }
        const body = this.tamperDownloads
          ? Buffer.concat([stored.body, Buffer.from([0])])
          : stored.body;
        return { readableStreamBody: Readable.from(body) };
      },
      downloadToFile: async (path: string) => {
        const stored = this.blobs.get(blobName);
        if (stored === undefined) {
          throw new Error("Blob does not exist.");
        }
        const body = this.tamperDownloads
          ? Buffer.concat([stored.body, Buffer.from([0])])
          : stored.body;
        writeFileSync(path, body, { flag: "wx" });
        return {};
      },
      exists: async () => this.blobs.has(blobName),
      uploadFile: async (
        path: string,
        options: {
          conditions?: { ifNoneMatch?: string };
          metadata?: Record<string, string>;
        },
      ) => {
        if (options.conditions?.ifNoneMatch !== "*") {
          throw new Error("Create-only condition was not supplied.");
        }
        if (this.blobs.has(blobName)) {
          throw new Error("ConditionNotMet");
        }
        this.blobs.set(blobName, {
          body: readFileSync(path),
          etag: `etag-${this.blobs.size + 1}`,
          metadata: { ...options.metadata },
        });
        return {};
      },
    };
  }

  async *listBlobsFlat(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? "";
    for (const [name, stored] of [...this.blobs.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (name.startsWith(prefix)) {
        yield {
          metadata: { ...stored.metadata },
          name,
          properties: {
            contentLength: stored.body.byteLength,
            etag: stored.etag,
          },
        };
      }
    }
  }

  async exists(): Promise<boolean> {
    return this.available;
  }

  asContainerClient(): ContainerClient {
    return this as unknown as ContainerClient;
  }
}

function artifact(filename: string, body: Buffer): ReplicationDestinationArtifact {
  return {
    bytes: body.byteLength,
    filename,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

describe("Azure Blob replication destination", () => {
  it("uploads with create-only writes, downloads, and rehashes encrypted artifacts", async () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), "memtextual-azure-source-"));
    const container = new FakeAzureBlobContainer();
    const database = Buffer.from("encrypted database");
    const manifest = Buffer.from("encrypted package manifest");
    writeFileSync(join(sourceDirectory, "database.enc"), database);
    writeFileSync(join(sourceDirectory, "replication-manifest.json"), manifest);
    try {
      const adapter = createAzureBlobReplicationAdapter({
        containerClient: container.asContainerClient(),
        prefix: "continuity/backups",
      });
      const result = await adapter.publishPackage({
        artifacts: [
          artifact("database.enc", database),
          artifact("replication-manifest.json", manifest),
        ],
        packageId: "00000000-0000-4000-8000-000000000001",
        packageName: "offsite-2026-10-14",
        sourceDirectory,
      });

      assert.equal(adapter.adapterId, "azure-blob");
      assert.equal(adapter.adapterVersion, "1");
      assert.match(adapter.destinationIdentity, /^[a-f0-9]{64}$/u);
      assert.equal(result.artifacts.length, 2);
      assert.equal(
        result.packageReference,
        `azure-blob://${adapter.destinationIdentity}/continuity/backups/offsite-2026-10-14`,
      );
      const stored = container.blobs.get(
        "continuity/backups/offsite-2026-10-14/database.enc",
      );
      assert.deepEqual(stored?.body, database);
      assert.equal(stored?.metadata.memtextualpackageid, "00000000-0000-4000-8000-000000000001");
      assert.equal(stored?.metadata.memtextualsha256, artifact("database.enc", database).sha256);

      assert.equal(
        await adapter.packageExists?.({
          artifacts: result.artifacts,
          packageName: "offsite-2026-10-14",
        }),
        true,
      );
      const materializationRoot = mkdtempSync(
        join(tmpdir(), "memtextual-azure-materialized-"),
      );
      try {
        const materialized = await adapter.materializePackage?.({
          artifacts: result.artifacts,
          destinationDirectory: materializationRoot,
          packageName: "offsite-2026-10-14",
        });
        assert.deepEqual(
          readFileSync(join(materialized?.packageDirectory ?? "", "database.enc")),
          database,
        );
        assert.deepEqual(materialized?.artifacts, result.artifacts);
      } finally {
        rmSync(materializationRoot, { force: true, recursive: true });
      }

      await adapter.removePackage({ packageName: "offsite-2026-10-14" });
      assert.equal(container.blobs.size, 0);
    } finally {
      rmSync(sourceDirectory, { force: true, recursive: true });
    }
  });

  it("retires only an exact package inventory with matching immutable evidence", async () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), "memtextual-azure-retire-"));
    const container = new FakeAzureBlobContainer();
    const database = Buffer.from("encrypted database");
    const manifest = Buffer.from("encrypted package manifest");
    writeFileSync(join(sourceDirectory, "database.enc"), database);
    writeFileSync(join(sourceDirectory, "replication-manifest.json"), manifest);
    const packageId = "00000000-0000-4000-8000-000000000011";
    const packageName = "offsite-2026-10-14-retire";
    try {
      const adapter = createAzureBlobReplicationAdapter({
        containerClient: container.asContainerClient(),
        prefix: "continuity/backups",
      });
      const publication = await adapter.publishPackage({
        artifacts: [
          artifact("database.enc", database),
          artifact("replication-manifest.json", manifest),
        ],
        packageId,
        packageName,
        sourceDirectory,
      });
      assert.notEqual(adapter.retirePackage, undefined);

      container.blobs.set(
        `continuity/backups/${packageName}/unexpected.enc`,
        { body: Buffer.from("unexpected"), etag: "etag-unexpected", metadata: {} },
      );
      assert.equal(
        await adapter.packageMatchesExactly!({
          artifacts: publication.artifacts,
          packageId,
          packageName,
        }),
        false,
      );
      await assert.rejects(
        adapter.retirePackage!({
          artifacts: publication.artifacts,
          packageId,
          packageName,
        }),
        /inventory or evidence changed/u,
      );
      assert.equal(container.blobs.size, 3);

      container.blobs.delete(
        `continuity/backups/${packageName}/unexpected.enc`,
      );
      container.tamperDownloads = true;
      assert.equal(
        await adapter.packageMatchesExactly!({
          artifacts: publication.artifacts,
          packageId,
          packageName,
        }),
        false,
      );
      container.tamperDownloads = false;
      assert.equal(
        await adapter.packageMatchesExactly!({
          artifacts: publication.artifacts,
          packageId,
          packageName,
        }),
        true,
      );
      await adapter.retirePackage!({
        artifacts: publication.artifacts,
        packageId,
        packageName,
      });
      assert.equal(container.blobs.size, 0);
    } finally {
      rmSync(sourceDirectory, { force: true, recursive: true });
    }
  });

  it("rolls back every uploaded blob when downloaded bytes do not match", async () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), "memtextual-azure-tamper-"));
    const container = new FakeAzureBlobContainer();
    container.tamperDownloads = true;
    const database = Buffer.from("encrypted database");
    writeFileSync(join(sourceDirectory, "database.enc"), database);
    try {
      const adapter = createAzureBlobReplicationAdapter({
        containerClient: container.asContainerClient(),
      });
      await assert.rejects(
        adapter.publishPackage({
          artifacts: [artifact("database.enc", database)],
          packageId: "00000000-0000-4000-8000-000000000002",
          packageName: "offsite-2026-10-14-tampered",
          sourceDirectory,
        }),
        /failed byte-for-byte verification/u,
      );
      assert.equal(container.blobs.size, 0);
    } finally {
      rmSync(sourceDirectory, { force: true, recursive: true });
    }
  });

  it("rejects unsafe identity, prefix, artifacts, and existing blobs before publication", async () => {
    assert.throws(
      () =>
        createAzureBlobReplicationAdapter({
          containerClient: new FakeAzureBlobContainer(
            "https://example.blob.core.windows.net/memtextual?sig=secret",
          ).asContainerClient(),
        }),
      /must not contain credentials, query parameters, or fragments/u,
    );
    assert.throws(
      () =>
        createAzureBlobReplicationAdapter({
          containerClient: new FakeAzureBlobContainer().asContainerClient(),
          prefix: "../unsafe",
        }),
      /safe segments/u,
    );

    const sourceDirectory = mkdtempSync(join(tmpdir(), "memtextual-azure-existing-"));
    const container = new FakeAzureBlobContainer();
    const database = Buffer.from("encrypted database");
    writeFileSync(join(sourceDirectory, "database.enc"), database);
    container.blobs.set("offsite-existing/database.enc", {
      body: Buffer.from("existing"),
      etag: "etag-existing",
      metadata: {},
    });
    try {
      const adapter = createAzureBlobReplicationAdapter({
        containerClient: container.asContainerClient(),
      });
      await assert.rejects(
        adapter.publishPackage({
          artifacts: [artifact("database.enc", database)],
          packageId: "00000000-0000-4000-8000-000000000003",
          packageName: "offsite-existing",
          sourceDirectory,
        }),
        /package already exists/u,
      );
      assert.deepEqual(
        container.blobs.get("offsite-existing/database.enc")?.body,
        Buffer.from("existing"),
      );
    } finally {
      rmSync(sourceDirectory, { force: true, recursive: true });
    }
  });

  it("uses a strict secret-free configuration bound to an authorized container client", () => {
    const value = {
      accountUrl: "https://example.blob.core.windows.net",
      adapterId: "azure-blob",
      containerName: "memtextual",
      credentialId: "continuity-service-certificate",
      formatVersion: 1,
      prefix: "continuity/backups",
    };
    const parsed = parseReplicationDestinationConfiguration(value);
    assert.deepEqual(parsed, value);

    const adapter = createConfiguredReplicationDestinationAdapter(parsed, {
      azureBlobContainerClient: new FakeAzureBlobContainer().asContainerClient(),
    });
    assert.equal(adapter.adapterId, "azure-blob");

    assert.throws(
      () => createConfiguredReplicationDestinationAdapter(parsed),
      /requires an explicitly authorized container client/u,
    );
    assert.throws(
      () =>
        createConfiguredReplicationDestinationAdapter(parsed, {
          azureBlobContainerClient: new FakeAzureBlobContainer(
            "https://other.blob.core.windows.net/memtextual",
          ).asContainerClient(),
        }),
      /does not match the configured account and container/u,
    );
    assert.throws(
      () =>
        parseReplicationDestinationConfiguration({
          ...value,
          clientSecret: "must-not-be-stored-here",
        }),
      /unsupported properties: clientSecret/u,
    );
    assert.throws(
      () =>
        parseReplicationDestinationConfiguration({
          ...value,
          accountUrl: "https://example.blob.core.windows.net?sig=secret",
        }),
      /without credentials, path, query, or fragment/u,
    );
  });

  it("requires an explicit unattended credential configuration for scheduled Azure use", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtextual-azure-cli-"));
    const configurationPath = join(directory, "destination.json");
    writeFileSync(
      configurationPath,
      JSON.stringify({
        accountUrl: "https://example.blob.core.windows.net",
        adapterId: "azure-blob",
        containerName: "memtextual",
        credentialId: "continuity-service-certificate",
        formatVersion: 1,
      }),
      "utf8",
    );
    try {
      const execution = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src", "cli", "safeguard.ts"),
          "offsite-status",
          "--database",
          join(directory, "memtextual.db"),
          "--source",
          directory,
          "--destination-config",
          configurationPath,
          "--interval-hours",
          "24",
        ],
        { cwd: resolve("."), encoding: "utf8" },
      );
      assert.equal(execution.status, 1);
      assert.match(
        execution.stderr,
        /Missing required --credential-config option/u,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
