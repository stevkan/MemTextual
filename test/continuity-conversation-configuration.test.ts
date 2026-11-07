import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertContinuityConversationMigrationsPath,
  loadContinuityConversationConfiguration,
  parseContinuityConversationConfiguration,
  resolveContinuityConversationConfiguration,
} from "../src/runtime/continuity-conversation-configuration.js";

function createFixture(): {
  configurationPath: string;
  databasePath: string;
  directory: string;
  executorScriptPath: string;
  stateDirectory: string;
  workingDirectory: string;
} {
  const directory = mkdtempSync(
    join(tmpdir(), "memtextual-conversation-config-"),
  );
  const applicationDirectory = join(directory, "application");
  const databaseDirectory = join(directory, "data");
  const backupDirectory = join(directory, "backup");
  const stateDirectory = join(directory, "state");
  const workingDirectory = join(directory, "conversation-workspace");
  const executorScriptPath = join(
    applicationDirectory,
    "scripts",
    "windows-host-executor.ps1",
  );
  const databasePath = join(databaseDirectory, "memtextual.db");
  mkdirSync(join(applicationDirectory, "scripts"), { recursive: true });
  mkdirSync(join(applicationDirectory, "migrations"), { recursive: true });
  mkdirSync(databaseDirectory, { recursive: true });
  mkdirSync(backupDirectory, { recursive: true });
  mkdirSync(workingDirectory, { recursive: true });
  writeFileSync(executorScriptPath, "# fixture\n", "utf8");
  writeFileSync(databasePath, "fixture", "utf8");

  const deploymentConfigurationPath = join(directory, "deployment.json");
  writeFileSync(
    deploymentConfigurationPath,
    JSON.stringify({
      applicationDirectory,
      backupDirectory,
      backupIntervalHours: 24,
      backupPollIntervalMinutes: 60,
      databasePath,
      formatVersion: 1,
      identityName: "MemTextualSvc",
      stateDirectory,
    }),
    "utf8",
  );
  const configurationPath = join(directory, "conversation.json");
  writeFileSync(
    configurationPath,
    JSON.stringify({
      adapterId: "codex-app-server-windows",
      deploymentConfigurationPath,
      extractionModel: "gpt-test",
      formatVersion: 1,
      workingDirectory,
    }),
    "utf8",
  );
  return {
    configurationPath,
    databasePath,
    directory,
    executorScriptPath,
    stateDirectory,
    workingDirectory,
  };
}

describe("Continuity conversation configuration", () => {
  it(
    "parses strict secret-free configuration",
    { skip: process.platform !== "win32" },
    () => {
    const fixture = createFixture();
    try {
      const loaded = loadContinuityConversationConfiguration(
        fixture.configurationPath,
      );
      assert.deepEqual(loaded, {
        adapterId: "codex-app-server-windows",
        deploymentConfigurationPath: join(
          fixture.directory,
          "deployment.json",
        ),
        extractionModel: "gpt-test",
        formatVersion: 1,
        workingDirectory: fixture.workingDirectory,
      });
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
    },
  );

  it("rejects unsupported properties, adapters, and relative paths", () => {
    const base = {
      adapterId: "codex-app-server-windows",
      deploymentConfigurationPath: "C:\\deployment.json",
      extractionModel: "gpt-test",
      formatVersion: 1,
      workingDirectory: "C:\\conversation-workspace",
    };
    assert.throws(
      () =>
        parseContinuityConversationConfiguration({
          ...base,
          apiKey: "must-not-be-stored-here",
        }),
      /unsupported properties: apiKey/u,
    );
    assert.throws(
      () =>
        parseContinuityConversationConfiguration({
          ...base,
          adapterId: "automatic",
        }),
      /adapterId must be codex-app-server-windows/u,
    );
    assert.throws(
      () =>
        parseContinuityConversationConfiguration({
          ...base,
          workingDirectory: ".\\conversation-workspace",
        }),
      /absolute Windows path/u,
    );
  });

  it(
    "resolves deployment-owned paths and rejects selected path mismatches",
    { skip: process.platform !== "win32" },
    () => {
      const fixture = createFixture();
      try {
        const resolved = resolveContinuityConversationConfiguration(
          fixture.configurationPath,
          fixture.databasePath.toUpperCase(),
        );
        assert.equal(resolved.databasePath, fixture.databasePath);
        assert.equal(resolved.executorScriptPath, fixture.executorScriptPath);
        assert.equal(
          resolved.migrationsDirectory,
          join(fixture.directory, "application", "migrations"),
        );
        assert.equal(resolved.stateDirectory, fixture.stateDirectory);

        assert.throws(
          () =>
            resolveContinuityConversationConfiguration(
              fixture.configurationPath,
              join(fixture.directory, "other.db"),
            ),
          /selected database does not match/u,
        );
        assert.throws(
          () =>
            assertContinuityConversationMigrationsPath(
              resolved,
              join(fixture.directory, "other-migrations"),
            ),
          /selected migrations directory does not match/u,
        );
      } finally {
        rmSync(fixture.directory, { force: true, recursive: true });
      }
    },
  );
});
