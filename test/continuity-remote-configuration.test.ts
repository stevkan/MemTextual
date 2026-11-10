import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  continuityRemoteResourceServerUrl,
  loadContinuityRemoteConfiguration,
  parseContinuityRemoteConfiguration,
} from "../src/index.js";

function validConfiguration() {
  return {
    formatVersion: 1,
    auth0Issuer: "https://memtextual-uat.us.auth0.com/",
    publicOrigin: "https://memory-uat.example.test/",
    port: 43_119,
    writeAuthorization: {
      mode: "trusted_oauth_client",
      trustedClientIds: ["https://chatgpt.com/oauth/client.json"],
    },
  };
}

test("Continuity remote configuration is strict, secret-free, and derives one MCP resource", () => {
  const configuration = parseContinuityRemoteConfiguration(validConfiguration());
  assert.deepEqual(configuration, validConfiguration());
  assert.equal(
    continuityRemoteResourceServerUrl(configuration).href,
    "https://memory-uat.example.test/mcp",
  );
  assert.equal(JSON.stringify(configuration).includes("secret"), false);

  const readOnly = parseContinuityRemoteConfiguration({
    ...validConfiguration(),
    writeAuthorization: { mode: "deny" },
  });
  assert.deepEqual(readOnly.writeAuthorization, { mode: "deny" });
});

test("Continuity remote configuration rejects ambiguous origins, ports, clients, and properties", () => {
  for (const invalid of [
    { ...validConfiguration(), publicOrigin: "http://memory.example.test/" },
    { ...validConfiguration(), publicOrigin: "https://memory.example.test/mcp" },
    { ...validConfiguration(), auth0Issuer: "https://tenant.auth0.com" },
    { ...validConfiguration(), port: 0 },
    {
      ...validConfiguration(),
      writeAuthorization: {
        mode: "trusted_oauth_client",
        trustedClientIds: ["chatgpt", "chatgpt"],
      },
    },
    {
      ...validConfiguration(),
      writeAuthorization: { mode: "trusted_oauth_client", trustedClientIds: [] },
    },
    { ...validConfiguration(), clientSecret: "must-not-be-accepted" },
  ]) {
    assert.throws(
      () => parseContinuityRemoteConfiguration(invalid),
      /remote configuration is invalid/iu,
    );
  }
});

test("Continuity remote configuration loads only direct valid JSON files", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-remote-config-"));
  try {
    const path = join(directory, "remote.json");
    writeFileSync(path, `${JSON.stringify(validConfiguration())}\n`, "utf8");
    assert.deepEqual(loadContinuityRemoteConfiguration(path), validConfiguration());

    const invalidPath = join(directory, "invalid.json");
    writeFileSync(invalidPath, "{", "utf8");
    assert.throws(
      () => loadContinuityRemoteConfiguration(invalidPath),
      /not valid JSON/iu,
    );
    assert.throws(
      () => loadContinuityRemoteConfiguration(join(directory, "missing.json")),
      /does not exist/iu,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
