import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import test from "node:test";
import {
  createDeveloperInstallationProfile,
  defaultDeveloperDataRoot,
  initializeDeveloperInstallation,
  loadDeveloperInstallationProfile,
  parseDeveloperInstallationProfile,
} from "../src/index.js";

function createBuiltApplication(root: string): string {
  const applicationDirectory = join(root, "application");
  const migrationsDirectory = join(applicationDirectory, "migrations");
  mkdirSync(migrationsDirectory, { recursive: true });
  for (const filename of readdirSync(resolve("migrations"))) {
    if (/^\d+.*\.sql$/u.test(filename)) {
      copyFileSync(resolve("migrations", filename), join(migrationsDirectory, filename));
    }
  }
  const mcpScript = join(applicationDirectory, "dist", "src", "mcp", "stdio.js");
  mkdirSync(dirname(mcpScript), { recursive: true });
  writeFileSync(mcpScript, "export {};\n", "utf8");
  return applicationDirectory;
}

function runCli(arguments_: readonly string[]): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", resolve("src", "cli", "memtextual.ts"), ...arguments_],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectProcess);
    child.on("close", (code) => resolveProcess({ code, stderr, stdout }));
  });
}

test("Developer installation defaults use per-user LocalAppData paths", () => {
  assert.equal(
    defaultDeveloperDataRoot({ LOCALAPPDATA: "D:\\Users\\Test\\AppData\\Local" }),
    "D:\\Users\\Test\\AppData\\Local\\MemTextual Developer",
  );
  const profile = createDeveloperInstallationProfile({
    applicationDirectory: "C:\\Program Files\\MemTextual Developer",
    dataRoot: "D:\\MemTextual Developer",
    nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
  });
  assert.equal(
    profile.databasePath,
    "D:\\MemTextual Developer\\data\\memtextual.db",
  );
  assert.equal(profile.backupDirectory, "D:\\MemTextual Developer\\backups");
  assert.equal(
    profile.installationProfilePath,
    "D:\\MemTextual Developer\\installation.json",
  );
  assert.equal(profile.serverName, "memtextual");
});

test("Developer installation profile rejects unknown properties", () => {
  assert.throws(
    () =>
      parseDeveloperInstallationProfile({
        ...createDeveloperInstallationProfile({
          applicationDirectory: "C:\\MemTextual",
          nodeExecutablePath: "C:\\Node\\node.exe",
        }),
        unexpected: true,
      }),
    /unsupported properties: unexpected/u,
  );
});

test("Developer setup initializes, snapshots, remembers, and safely reuses paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "memtextual-developer-installation-"));
  try {
    const applicationDirectory = createBuiltApplication(root);
    const dataRoot = join(root, "user-data");
    const result = await initializeDeveloperInstallation({
      applicationDirectory,
      dataRoot,
      nodeExecutablePath: process.execPath,
    });
    assert.equal(result.created, true);
    assert.equal(result.databaseCreated, true);
    assert.ok(result.snapshotPath);
    assert.equal(existsSync(result.snapshotPath!), true);
    assert.equal(existsSync(win32.join(dataRoot, "data", "memtextual.db")), true);

    const saved = loadDeveloperInstallationProfile(
      win32.join(dataRoot, "installation.json"),
    );
    assert.equal(saved.dataRoot, win32.resolve(dataRoot));
    assert.equal(saved.applicationDirectory, win32.resolve(applicationDirectory));
    assert.equal(saved.nodeExecutablePath, win32.resolve(process.execPath));

    const repeated = await initializeDeveloperInstallation({
      applicationDirectory,
      dataRoot,
      nodeExecutablePath: process.execPath,
    });
    assert.equal(repeated.created, false);
    assert.equal(repeated.databaseCreated, false);

    await assert.rejects(
      initializeDeveloperInstallation({
        applicationDirectory,
        dataRoot,
        databasePath: join(root, "other", "data", "different.db"),
        nodeExecutablePath: process.execPath,
      }),
      /different databasePath/u,
    );
    await assert.rejects(
      initializeDeveloperInstallation({
        applicationDirectory,
        backupDirectory: join(root, "overlap"),
        dataRoot,
        databasePath: join(root, "overlap", "data", "memtextual.db"),
        nodeExecutablePath: process.execPath,
      }),
      /database may not be stored inside/u,
    );

    await assert.rejects(
      initializeDeveloperInstallation({
        applicationDirectory,
        backupDirectory: join(root, "active", "backups"),
        dataRoot,
        databasePath: join(root, "active", "memtextual.db"),
        nodeExecutablePath: process.execPath,
      }),
      /backup directory may not be stored inside/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("unified Developer setup remembers paths and makes status path-free", async () => {
  const root = mkdtempSync(join(tmpdir(), "memtextual-developer-cli-"));
  try {
    const applicationDirectory = createBuiltApplication(root);
    const dataRoot = join(root, "user-data");
    const setup = await runCli([
      "developer",
      "setup",
      "--data-root", dataRoot,
      "--application-directory", applicationDirectory,
      "--node", process.execPath,
    ]);
    assert.equal(setup.code, 0, setup.stderr);
    assert.equal(setup.stderr, "");
    assert.match(setup.stdout, /connect-preview/u);

    const status = await runCli(["developer", "status", "--data-root", dataRoot]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(status.stderr, "");
    assert.match(status.stdout, /"serverName": "memtextual"/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("Developer source CLI accepts npm's additional argument separator", async () => {
  const root = mkdtempSync(join(tmpdir(), "memtextual-developer-separator-"));
  try {
    const result = await runCli([
      "developer",
      "connect-preview",
      "--",
      "--data-root", root,
      "--codex-command", "X:\\missing\\codex.exe",
    ]);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /Unknown argument/u);
    assert.match(result.stderr, /installation profile does not exist/iu);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
