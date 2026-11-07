import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import test from "node:test";
import {
  createContinuityInstallationConfiguration,
  defaultContinuityDataRoot,
  loadContinuityInstallationProfile,
  parseContinuityInstallationProfile,
} from "../src/index.js";

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

test("Continuity installation defaults use ProgramData and stable managed paths", () => {
  assert.equal(
    defaultContinuityDataRoot({ ProgramData: "D:\\SharedData" }),
    "D:\\SharedData\\MemTextual Continuity",
  );
  const configuration = createContinuityInstallationConfiguration({
    applicationDirectory: "C:\\Program Files\\MemTextual\\Continuity",
    dataRoot: "D:\\MemTextual",
    extractionModel: "gpt-example",
  });
  assert.equal(configuration.paths.databasePath, "D:\\MemTextual\\data\\memtextual.db");
  assert.equal(configuration.paths.backupDirectory, "D:\\MemTextual\\backups");
  assert.equal(
    configuration.paths.deploymentConfigurationPath,
    "D:\\MemTextual\\deployment.json",
  );
  assert.equal(
    configuration.paths.conversationConfigurationPath,
    "D:\\MemTextual\\conversation.json",
  );
  assert.equal(configuration.deployment.identityName, "MemTextualSvc");
  assert.equal(configuration.conversation.extractionModel, "gpt-example");
});

test("Continuity installation profile rejects unknown properties", () => {
  assert.throws(
    () =>
      parseContinuityInstallationProfile({
        applicationDirectory: "C:\\app",
        backupDirectory: "C:\\data\\backups",
        conversationConfigurationPath: "C:\\data\\conversation.json",
        dataRoot: "C:\\data",
        databasePath: "C:\\data\\data\\memtextual.db",
        deploymentConfigurationPath: "C:\\data\\deployment.json",
        formatVersion: 1,
        installationProfilePath: "C:\\data\\installation.json",
        migrationsDirectory: "C:\\app\\migrations",
        personaId: "persona",
        stateDirectory: "C:\\data\\host-state",
        unexpected: true,
        userId: "user",
        workingDirectory: "C:\\data\\conversations",
      }),
    /unsupported properties: unexpected/u,
  );
});

test(
  "unified setup rejects extraction-model placeholder text",
  { skip: process.platform !== "win32" },
  async () => {
  const result = await runCli([
    "setup",
    "--user-name", "Test User",
    "--persona-name", "Test Persona",
    "--extraction-model", "MODEL_ID",
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /actual model identifier/u);
  },
);

test(
  "unified setup remembers paths and makes status path-free",
  { skip: process.platform !== "win32" },
  async () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-installation-"));
  try {
    const setup = await runCli([
      "setup",
      "--user-name", "Test User",
      "--persona-name", "Test Persona",
      "--extraction-model", "gpt-example",
      "--data-root", directory,
      "--application-directory", resolve("."),
    ]);
    assert.equal(setup.code, 0, setup.stderr);
    assert.equal(setup.stderr, "");

    const profile = loadContinuityInstallationProfile(
      win32.join(directory, "installation.json"),
    );
    assert.equal(profile.dataRoot, win32.resolve(directory));
    assert.equal(profile.databasePath, win32.join(directory, "data", "memtextual.db"));
    assert.ok(profile.userId.length > 0);
    assert.ok(profile.personaId.length > 0);

    const deployment = JSON.parse(
      readFileSync(win32.join(directory, "deployment.json"), "utf8"),
    ) as { databasePath: string };
    const conversation = JSON.parse(
      readFileSync(win32.join(directory, "conversation.json"), "utf8"),
    ) as { extractionModel: string };
    assert.equal(deployment.databasePath, profile.databasePath);
    assert.equal(conversation.extractionModel, "gpt-example");

    const status = await runCli(["status", "--data-root", directory]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(status.stderr, "");
    assert.match(status.stdout, /"name": "Test Persona"/u);

    const repeat = await runCli([
      "setup",
      "--user-name", "Test User",
      "--persona-name", "Test Persona",
      "--extraction-model", "gpt-example",
      "--data-root", directory,
      "--application-directory", resolve("."),
    ]);
    assert.equal(repeat.code, 0, repeat.stderr);
    assert.match(repeat.stdout, /already configured/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  },
);
