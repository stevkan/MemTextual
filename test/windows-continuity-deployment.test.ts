import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { parseWindowsHostCliArguments } from "../src/cli/windows-host.js";
import {
  createWindowsContinuityDeploymentPlan,
  parseWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentEnvironment,
  validateWindowsContinuityDeploymentPlan,
} from "../src/index.js";

function baseConfiguration(root: string) {
  return {
    applicationDirectory: join(root, "app"),
    backupDirectory: join(root, "backups"),
    backupIntervalHours: 24,
    backupPollIntervalMinutes: 60,
    databasePath: join(root, "data", "memtextual.db"),
    formatVersion: 1 as const,
    identityName: "MemTextualSvc",
    stateDirectory: join(root, "state", "host"),
  };
}

function createDeploymentFiles(root: string): void {
  const directories = [
    join(root, "app", "dist", "src", "cli"),
    join(root, "app", "runtime"),
    join(root, "app", "scripts"),
    join(root, "backups"),
    join(root, "data"),
    join(root, "state"),
  ];
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(root, "app", "runtime", "node.exe"), "runtime", "utf8");
  writeFileSync(
    join(root, "app", "dist", "src", "cli", "safeguard.js"),
    "entrypoint",
    "utf8",
  );
  writeFileSync(join(root, "data", "memtextual.db"), "database", "utf8");
  writeFileSync(
    join(root, "app", "scripts", "windows-host-executor.ps1"),
    "executor",
    "utf8",
  );
}

describe("Windows Continuity deployment", () => {
  it(
    "creates a fixed bundled-runtime layout and backup schedule",
    { skip: process.platform !== "win32" },
    () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-windows-layout-"));
    try {
      createDeploymentFiles(root);
      const deployment = parseWindowsContinuityDeploymentConfiguration(
        baseConfiguration(root),
      );
      const plan = createWindowsContinuityDeploymentPlan(deployment);
      validateWindowsContinuityDeploymentPlan(plan);
      assert.equal(
        plan.nodeExecutablePath,
        join(root, "app", "runtime", "node.exe"),
      );
      assert.equal(plan.host.schedules.length, 1);
      assert.deepEqual(plan.host.schedules[0]?.command.arguments.slice(0, 2), [
        join(root, "app", "dist", "src", "cli", "safeguard.js"),
        "run-if-due",
      ]);
      assert.deepEqual(plan.host.protectedPaths, [
        { access: "read", mode: "grant", path: join(root, "app") },
        { access: "modify", mode: "grant", path: join(root, "data") },
        { access: "modify", mode: "grant", path: join(root, "backups") },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    },
  );

  it(
    "adds local offsite scheduling without storing the key value",
    { skip: process.platform !== "win32" },
    () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-windows-offsite-"));
    try {
      createDeploymentFiles(root);
      const destination = join(root, "offsite");
      mkdirSync(destination);
      const destinationConfigurationPath = join(root, "destination.json");
      writeFileSync(
        destinationConfigurationPath,
        JSON.stringify({
          adapterId: "local-directory",
          destinationDirectory: destination,
          formatVersion: 1,
        }),
        "utf8",
      );
      const deployment = parseWindowsContinuityDeploymentConfiguration({
        ...baseConfiguration(root),
        offsite: {
          destinationConfigurationPath,
          intervalHours: 24,
          keyEnvironmentVariable: "MEMTEXTUAL_OFFSITE_KEY",
          keyId: "recovery-2026",
          pollIntervalMinutes: 60,
        },
      });
      const plan = createWindowsContinuityDeploymentPlan(deployment);
      validateWindowsContinuityDeploymentPlan(plan);
      const schedule = plan.host.schedules[1]!;
      assert.equal(schedule.scheduleId, "MemTextual-Offsite");
      assert.deepEqual(schedule.command.environmentVariableNames, [
        "MEMTEXTUAL_OFFSITE_KEY",
      ]);
      assert.equal(
        JSON.stringify(plan).includes("test-secret-value"),
        false,
      );
      assert.deepEqual(plan.host.protectedPaths.at(-1), {
        access: "modify",
        mode: "grant",
        path: destination,
      });
      assert.throws(
        () => validateWindowsContinuityDeploymentEnvironment(plan, {}),
        /recovery-key environment variable is missing/u,
      );
      const encodedKey = Buffer.alloc(32, 7).toString("base64");
      assert.doesNotThrow(() =>
        validateWindowsContinuityDeploymentEnvironment(plan, {
          MEMTEXTUAL_OFFSITE_KEY: encodedKey,
        }),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    },
  );

  it(
    "binds matching Azure destination and certificate references",
    { skip: process.platform !== "win32" },
    () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-windows-azure-"));
    try {
      createDeploymentFiles(root);
      const destinationConfigurationPath = join(root, "destination.json");
      const credentialConfigurationPath = join(root, "credential.json");
      writeFileSync(
        destinationConfigurationPath,
        JSON.stringify({
          accountUrl: "https://example.blob.core.windows.net",
          adapterId: "azure-blob",
          containerName: "memtextual",
          credentialId: "continuity-service-certificate",
          formatVersion: 1,
        }),
        "utf8",
      );
      writeFileSync(
        credentialConfigurationPath,
        JSON.stringify({
          certificatePath: resolve(
            "test",
            "fixtures",
            "azure-test-credential.pem",
          ),
          clientId: "11111111-1111-4111-8111-111111111111",
          credentialId: "continuity-service-certificate",
          formatVersion: 1,
          tenantId: "22222222-2222-4222-8222-222222222222",
        }),
        "utf8",
      );
      const deployment = parseWindowsContinuityDeploymentConfiguration({
        ...baseConfiguration(root),
        offsite: {
          credentialConfigurationPath,
          destinationConfigurationPath,
          intervalHours: 24,
          keyEnvironmentVariable: "MEMTEXTUAL_OFFSITE_KEY",
          keyId: "recovery-2026",
          pollIntervalMinutes: 60,
        },
      });
      const plan = createWindowsContinuityDeploymentPlan(deployment);
      validateWindowsContinuityDeploymentPlan(plan);
      assert.deepEqual(
        plan.host.schedules[1]?.command.arguments.slice(-8),
        [
          "--credential-config",
          credentialConfigurationPath,
          "--interval-hours",
          "24",
          "--key-env",
          "MEMTEXTUAL_OFFSITE_KEY",
          "--key-id",
          "recovery-2026",
        ],
      );
      assert.deepEqual(
        plan.host.protectedPaths.find(
          ({ path }) => path === resolve("test", "fixtures", "azure-test-credential.pem"),
        ),
        {
          access: "read",
          mode: "restrict",
          path: resolve("test", "fixtures", "azure-test-credential.pem"),
        },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
    },
  );

  it("rejects unknown and secret-bearing deployment properties", () => {
    const configuration = baseConfiguration("C:\\MemTextualTest");
    assert.throws(
      () =>
        parseWindowsContinuityDeploymentConfiguration({
          ...configuration,
          accountKey: "must-not-be-stored",
        }),
      /unsupported properties: accountKey/u,
    );
    assert.throws(
      () =>
        parseWindowsContinuityDeploymentConfiguration({
          ...configuration,
          offsite: {
            destinationConfigurationPath: "C:\\destination.json",
            intervalHours: 24,
            keyEnvironmentVariable: "MEMTEXTUAL_OFFSITE_KEY",
            keyId: "recovery-2026",
            keyValue: "must-not-be-stored",
            pollIntervalMinutes: 60,
          },
        }),
      /unsupported properties: keyValue/u,
    );
  });

  it("requires explicit confirmation and actor only for apply commands", () => {
    assert.deepEqual(
      parseWindowsHostCliArguments([
        "install-preview",
        "--config",
        "deployment.json",
      ]),
      {
        command: "install-preview",
        configurationPath: "deployment.json",
      },
    );
    assert.throws(
      () =>
        parseWindowsHostCliArguments([
          "install-apply",
          "--config",
          "deployment.json",
        ]),
      /--confirm is required/u,
    );
    assert.deepEqual(
      parseWindowsHostCliArguments([
        "remove-apply",
        "--config",
        "deployment.json",
        "--confirm",
        "REMOVE-WINDOWS-HOST-EXAMPLE",
        "--actor",
        "local-user",
      ]),
      {
        actorId: "local-user",
        command: "remove-apply",
        configurationPath: "deployment.json",
        confirmation: "REMOVE-WINDOWS-HOST-EXAMPLE",
      },
    );
  });
});
