import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";
import {
  renderContinuityCloudflareTunnelConfiguration,
  writeContinuityCloudflareTunnelConfiguration,
} from "../src/index.js";

const configuration = {
  formatVersion: 1 as const,
  auth0Issuer: "https://memtextual-uat.us.auth0.com/",
  publicOrigin: "https://memory-uat.example.test/",
  port: 43_119,
  writeAuthorization: { mode: "deny" as const },
};

test("Cloudflare tunnel configuration exposes one hostname to loopback and denies fallback ingress", () => {
  const content = renderContinuityCloudflareTunnelConfiguration({
    configuration,
    credentialsFile: "C:\\Cloudflare\\a17e224c-9094-48bc-9408-5f35ac463d25.json",
    tunnelId: "a17e224c-9094-48bc-9408-5f35ac463d25",
  });
  assert.equal(
    content,
    [
      'tunnel: "a17e224c-9094-48bc-9408-5f35ac463d25"',
      'credentials-file: "C:\\\\Cloudflare\\\\a17e224c-9094-48bc-9408-5f35ac463d25.json"',
      "ingress:",
      '  - hostname: "memory-uat.example.test"',
      '    service: "http://127.0.0.1:43119"',
      "  - service: http_status:404",
      "",
    ].join("\n"),
  );
  assert.equal(content.includes("0.0.0.0"), false);
});

test("Cloudflare tunnel configuration rejects unsafe identifiers, paths, and public ports", () => {
  assert.throws(
    () =>
      renderContinuityCloudflareTunnelConfiguration({
        configuration,
        credentialsFile: "relative.json",
        tunnelId: "a17e224c-9094-48bc-9408-5f35ac463d25",
      }),
    /absolute Windows path/iu,
  );
  assert.throws(
    () =>
      renderContinuityCloudflareTunnelConfiguration({
        configuration,
        credentialsFile: "C:\\Cloudflare\\credential.json",
        tunnelId: "not-a-uuid",
      }),
    /invalid uuid/iu,
  );
  assert.throws(
    () =>
      renderContinuityCloudflareTunnelConfiguration({
        configuration: {
          ...configuration,
          publicOrigin: "https://memory-uat.example.test:8443/",
        },
        credentialsFile: "C:\\Cloudflare\\credential.json",
        tunnelId: "a17e224c-9094-48bc-9408-5f35ac463d25",
      }),
    /standard HTTPS port/iu,
  );
});

test("Cloudflare tunnel configuration is written create-once", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-cloudflare-"));
  const output = win32.join(directory, "config.yml");
  try {
    assert.equal(
      writeContinuityCloudflareTunnelConfiguration(output, "test\n"),
      win32.resolve(output),
    );
    assert.equal(readFileSync(output, "utf8"), "test\n");
    assert.throws(
      () => writeContinuityCloudflareTunnelConfiguration(output, "changed\n"),
      /EEXIST/iu,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
