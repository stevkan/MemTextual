import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";
import {
  assertDeveloperCodexRegistrationConfirmation,
  createDeveloperInstallationProfile,
  discoverCodexDesktopCommands,
  developerCodexRegistration,
  parseCodexMcpList,
  previewDeveloperCodexRegistration,
  resolveCodexCommand,
  selectCodexDesktopCommand,
} from "../src/index.js";

const profile = createDeveloperInstallationProfile({
  applicationDirectory: "C:\\Program Files\\MemTextual Developer",
  dataRoot: "D:\\MemTextual Developer",
  nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
});

test("Developer Codex registration preview requires an exact fresh token", () => {
  const preview = previewDeveloperCodexRegistration(profile, []);
  assert.equal(preview.action, "add");
  assert.match(preview.confirmation ?? "", /^CONNECT-CODEX-MCP-[A-F0-9]{24}$/u);
  assert.deepEqual(preview.registration, developerCodexRegistration(profile));
  assert.doesNotThrow(() =>
    assertDeveloperCodexRegistrationConfirmation(
      preview,
      preview.confirmation!,
    ),
  );
  assert.throws(
    () => assertDeveloperCodexRegistrationConfirmation(preview, "stale"),
    /stale or incorrect/u,
  );
});

test("Developer Codex registration is idempotent for an exact match", () => {
  const registration = developerCodexRegistration(profile);
  const inventory = parseCodexMcpList([
    {
      name: registration.name,
      transport: {
        args: [...registration.arguments],
        command: registration.command,
        type: "stdio",
      },
    },
  ]);
  const preview = previewDeveloperCodexRegistration(profile, inventory);
  assert.equal(preview.action, "already-connected");
  assert.equal(preview.confirmation, undefined);
  assert.throws(
    () => assertDeveloperCodexRegistrationConfirmation(preview, "anything"),
    /not eligible/u,
  );
});

test("Developer Codex registration refuses to overwrite a same-name server", () => {
  const inventory = parseCodexMcpList([
    {
      name: profile.serverName,
      transport: {
        args: ["C:\\Other\\server.js"],
        command: "C:\\Other\\node.exe",
        type: "stdio",
      },
    },
  ]);
  const preview = previewDeveloperCodexRegistration(profile, inventory);
  assert.equal(preview.action, "blocked-existing");
  assert.equal(preview.confirmation, undefined);
  assert.match(preview.reason, /not changed/u);
});

test("Codex MCP inventory accepts other transports and rejects malformed entries", () => {
  assert.throws(() => parseCodexMcpList({}), /must be an array/u);

  const unrelated = parseCodexMcpList([
    {
      name: "remote-server",
      transport: { type: "streamable_http", url: "https://example.invalid/mcp" },
    },
  ]);
  assert.equal(
    previewDeveloperCodexRegistration(profile, unrelated).action,
    "add",
  );

  const conflicting = parseCodexMcpList([
    {
      name: profile.serverName,
      transport: { type: "streamable_http", url: "https://example.invalid/mcp" },
    },
  ]);
  assert.equal(
    previewDeveloperCodexRegistration(profile, conflicting).action,
    "blocked-existing",
  );

  assert.throws(
    () =>
      parseCodexMcpList([
        {
          name: "memtextual",
          transport: { command: "node" },
        },
      ]),
    /unsupported entry/u,
  );
});

test(
  "Codex desktop command discovery is deterministic and refuses ambiguity",
  { skip: process.platform !== "win32" },
  () => {
  const root = mkdtempSync(join(tmpdir(), "memtextual-codex-discovery-"));
  try {
    const first = join(root, "OpenAI", "Codex", "bin", "build-a", "codex.exe");
    mkdirSync(win32.dirname(first), { recursive: true });
    writeFileSync(first, "", "utf8");
    assert.deepEqual(
      discoverCodexDesktopCommands({ localAppData: root, platform: "win32" }),
      [win32.resolve(first)],
    );
    assert.equal(selectCodexDesktopCommand([first]), first);

    const second = join(root, "OpenAI", "Codex", "bin", "build-b", "codex.exe");
    mkdirSync(win32.dirname(second), { recursive: true });
    writeFileSync(second, "", "utf8");
    const candidates = discoverCodexDesktopCommands({
      localAppData: root,
      platform: "win32",
    });
    assert.equal(candidates.length, 2);
    assert.throws(
      () => selectCodexDesktopCommand(candidates),
      /Multiple Codex desktop CLI installations/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  },
);

test(
  "Codex command resolution prefers an explicit command and then PATH",
  { skip: process.platform !== "win32" },
  () => {
  const root = mkdtempSync(join(tmpdir(), "memtextual-codex-path-"));
  try {
    const executable = join(root, "codex.exe");
    writeFileSync(executable, "", "utf8");
    assert.equal(
      resolveCodexCommand({
        environment: { LOCALAPPDATA: "X:\\missing", Path: root },
        platform: "win32",
      }),
      win32.resolve(executable),
    );
    assert.equal(
      resolveCodexCommand({ explicitCommand: " C:\\Explicit\\codex.exe " }),
      "C:\\Explicit\\codex.exe",
    );
    assert.throws(
      () => resolveCodexCommand({ explicitCommand: " " }),
      /must not be empty/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  },
);
