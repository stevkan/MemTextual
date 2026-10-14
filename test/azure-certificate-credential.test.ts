import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  AzureCertificateCredentialProvider,
  loadAzureCertificateCredentialConfiguration,
  parseAzureCertificateCredentialConfiguration,
} from "../src/credentials/azure-certificate-credential.js";
import { createAuthorizedAzureBlobReplicationAdapter } from "../src/safeguards/azure-blob-authorized-adapter.js";

const certificatePath = resolve(
  "test",
  "fixtures",
  "azure-test-credential.pem",
);

const configuration = {
  certificatePath,
  clientId: "11111111-1111-4111-8111-111111111111",
  credentialId: "continuity-service-certificate",
  formatVersion: 1 as const,
  tenantId: "22222222-2222-4222-8222-222222222222",
};

describe("Azure certificate credential provider", () => {
  it("loads strict secret-free configuration and reports certificate health", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtextual-azure-credential-"));
    try {
      const configurationPath = join(directory, "credential.json");
      writeFileSync(configurationPath, JSON.stringify(configuration), "utf8");
      assert.deepEqual(
        loadAzureCertificateCredentialConfiguration(configurationPath),
        configuration,
      );

      const provider = new AzureCertificateCredentialProvider({
        configuration,
        now: () => new Date("2029-12-15T00:00:00.000Z"),
      });
      const status = provider.inspect({
        credentialId: configuration.credentialId,
        kind: "certificate",
      });
      assert.equal(status.health, "expiring");
      assert.equal(status.certificateExpiresAt, "2030-01-01T00:00:00.000Z");
      assert.match(status.certificateFingerprint256, /^[a-f0-9]{64}$/u);
      assert.equal(JSON.stringify(status).includes(certificatePath), false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("acquires an SDK credential only for the matching usable reference", async () => {
    const provider = new AzureCertificateCredentialProvider({
      configuration,
      now: () => new Date("2027-01-01T00:00:00.000Z"),
    });
    const credential = await provider.acquire({
      credentialId: configuration.credentialId,
      kind: "certificate",
    });
    assert.equal(typeof credential.getToken, "function");

    await assert.rejects(
      provider.acquire({ credentialId: "other", kind: "certificate" }),
      /reference does not match/u,
    );
    const expired = new AzureCertificateCredentialProvider({
      configuration,
      now: () => new Date("2030-01-02T00:00:00.000Z"),
    });
    await assert.rejects(
      expired.acquire({
        credentialId: configuration.credentialId,
        kind: "certificate",
      }),
      /not currently usable: expired/u,
    );
  });

  it("binds the matching certificate reference to an Azure Blob adapter", async () => {
    const provider = new AzureCertificateCredentialProvider({
      configuration,
      now: () => new Date("2027-01-01T00:00:00.000Z"),
    });
    const authorized = await createAuthorizedAzureBlobReplicationAdapter(
      {
        accountUrl: "https://example.blob.core.windows.net",
        adapterId: "azure-blob",
        containerName: "memtextual",
        credentialId: configuration.credentialId,
        formatVersion: 1,
      },
      provider,
    );
    assert.equal(authorized.adapter.adapterId, "azure-blob");
    assert.equal(authorized.credentialStatus.health, "valid");
    assert.match(authorized.adapter.destinationIdentity, /^[a-f0-9]{64}$/u);
  });

  it("rejects secret fields, unsafe paths, and encrypted private keys", () => {
    assert.throws(
      () =>
        parseAzureCertificateCredentialConfiguration({
          ...configuration,
          clientSecret: "must-not-be-stored-here",
        }),
      /unsupported properties: clientSecret/u,
    );
    assert.throws(
      () =>
        parseAzureCertificateCredentialConfiguration({
          ...configuration,
          certificatePath: ".\\relative.pem",
        }),
      /must be a non-empty absolute path/u,
    );

    const directory = mkdtempSync(join(tmpdir(), "memtextual-azure-encrypted-"));
    try {
      const encryptedPath = join(directory, "encrypted.pem");
      writeFileSync(
        encryptedPath,
        "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n-----BEGIN ENCRYPTED PRIVATE KEY-----\nsecret\n-----END ENCRYPTED PRIVATE KEY-----\n",
        "utf8",
      );
      const provider = new AzureCertificateCredentialProvider({
        configuration: { ...configuration, certificatePath: encryptedPath },
      });
      assert.throws(
        () =>
          provider.inspect({
            credentialId: configuration.credentialId,
            kind: "certificate",
          }),
        /Encrypted PEM private keys are not supported/u,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("reports certificate expiration health through the safeguard CLI", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtextual-azure-status-"));
    try {
      const configurationPath = join(directory, "credential.json");
      writeFileSync(configurationPath, JSON.stringify(configuration), "utf8");
      const execution = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src", "cli", "safeguard.ts"),
          "azure-credential-status",
          "--credential-config",
          configurationPath,
        ],
        { cwd: resolve("."), encoding: "utf8" },
      );
      assert.equal(execution.status, 0, execution.stderr);
      const status = JSON.parse(execution.stdout) as Record<string, unknown>;
      assert.equal(status.credentialId, configuration.credentialId);
      assert.equal(status.certificateExpiresAt, "2030-01-01T00:00:00.000Z");
      assert.match(String(status.health), /^(?:valid|expiring|expired)$/u);
      assert.equal(execution.stdout.includes(certificatePath), false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
