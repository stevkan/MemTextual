import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseWindowsElevatedHostValidationArguments } from "../src/cli/windows-elevated-host-validation.js";
import {
  applyWindowsElevatedHostValidation,
  createWindowsContinuityBundle,
  createWindowsContinuityDeploymentPlan,
  parseWindowsContinuityDeploymentConfiguration,
  previewWindowsElevatedHostValidation,
  type HostScheduleDefinition,
  type HostServiceIdentityRequest,
  type HostServiceIdentityState,
  type WindowsHostOperations,
  type WindowsManagedScheduleState,
  type WindowsPathProtectionState,
  type WindowsPathRestorationState,
  type WindowsProtectedPath,
} from "../src/index.js";

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function createCandidateSource(source: string): void {
  write(
    join(source, "package.json"),
    `${JSON.stringify({
      dependencies: { "production-package": "1.0.0" },
      engines: { node: process.versions.node },
      name: "memtextual",
      type: "module",
      version: "0.8.0",
    })}\n`,
  );
  write(
    join(source, "package-lock.json"),
    `${JSON.stringify({
      lockfileVersion: 3,
      name: "memtextual",
      packages: {
        "": {
          dependencies: { "production-package": "1.0.0" },
          name: "memtextual",
          version: "0.8.0",
        },
        "node_modules/production-package": { version: "1.0.0" },
      },
      version: "0.8.0",
    })}\n`,
  );
  write(join(source, "README.md"), "# Synthetic candidate\n");
  write(join(source, "CHANGELOG.md"), "# Synthetic changelog\n");
  write(join(source, "LICENSE.txt"), "Synthetic test license.\n");
  for (const name of [
    "continuity-acceptance",
    "continuity-console",
    "continuity-release-validation",
    "continuity-setup",
    "continuity-upgrade",
    "safeguard",
    "windows-elevated-host-validation",
    "windows-host",
    "windows-msi-host-action",
  ]) {
    write(join(source, "dist", "src", "cli", `${name}.js`), "export {};\n");
  }
  write(
    join(source, "node_modules", "production-package", "package.json"),
    '{"name":"production-package","version":"1.0.0"}\n',
  );
  write(join(source, "scripts", "windows-host-executor.ps1"), "param()\n");
  write(join(source, "migrations", "001_initial.sql"), "SELECT 1;\n");
}

class FakeOperations implements WindowsHostOperations {
  readonly identities = new Map<string, HostServiceIdentityState>();
  readonly schedules = new Map<string, WindowsManagedScheduleState>();

  async inspectIdentity(identityName: string): Promise<HostServiceIdentityState> {
    return this.identities.get(identityName) ?? {
      available: false,
      identityName,
      managedByMemTextual: false,
    };
  }

  async inspectSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    return this.schedules.get(scheduleId) ?? {
      enabled: false,
      installed: false,
      managedByMemTextual: false,
      scheduleId,
    };
  }

  async installSchedule(
    definition: HostScheduleDefinition,
  ): Promise<WindowsManagedScheduleState> {
    const state = {
      definition,
      enabled: true,
      installed: true,
      managedByMemTextual: true,
      scheduleId: definition.scheduleId,
    };
    this.schedules.set(definition.scheduleId, state);
    return state;
  }

  async protectPaths(): Promise<WindowsPathProtectionState> {
    return { created: true, protected: true };
  }

  async provisionIdentity(
    request: HostServiceIdentityRequest,
  ): Promise<HostServiceIdentityState> {
    const state = {
      available: true,
      identityName: request.identityName,
      managedByMemTextual: true,
    };
    this.identities.set(request.identityName, state);
    return state;
  }

  async removeIdentity(identityName: string): Promise<HostServiceIdentityState> {
    this.identities.delete(identityName);
    return { available: false, identityName, managedByMemTextual: false };
  }

  async removeSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    this.schedules.delete(scheduleId);
    return {
      enabled: false,
      installed: false,
      managedByMemTextual: false,
      scheduleId,
    };
  }

  async restorePaths(
    _paths: readonly WindowsProtectedPath[],
  ): Promise<WindowsPathRestorationState> {
    return { restored: true };
  }
}

describe("Windows elevated host validation", () => {
  it("requires separate preview and apply inputs", () => {
    assert.deepEqual(
      parseWindowsElevatedHostValidationArguments([
        "preview",
        "--config",
        "deployment.json",
        "--workspace",
        "C:\\validation",
      ]),
      {
        command: "preview",
        configurationPath: "deployment.json",
        workspaceDirectory: "C:\\validation",
      },
    );
    assert.throws(
      () =>
        parseWindowsElevatedHostValidationArguments([
          "apply",
          "--config",
          "deployment.json",
          "--workspace",
          "C:\\validation",
        ]),
      /requires --confirm and --actor/u,
    );
  });

  it("installs, validates, and removes only synthetic host resources", async () => {
    const root = mkdtempSync(join(tmpdir(), "memtextual-elevated-host-"));
    const source = join(root, "source");
    const output = join(root, "output");
    const workspace = join(root, "workspace");
    const backupDirectory = join(workspace, "host-validation-backups");
    const databasePath = join(workspace, "data", "memtextual.db");
    const signingPem = resolve("test", "fixtures", "azure-test-credential.pem");
    try {
      mkdirSync(source);
      mkdirSync(output);
      mkdirSync(backupDirectory, { recursive: true });
      write(databasePath, "synthetic database\n");
      createCandidateSource(source);
      const candidate = await createWindowsContinuityBundle({
        applicationLicensePath: join(source, "LICENSE.txt"),
        createdAt: new Date("2027-02-03T00:00:00.000Z"),
        outputDirectory: output,
        runtimeExecutablePath: process.execPath,
        runtimeLicensePath: join(dirname(process.execPath), "LICENSE"),
        signingCertificatePath: signingPem,
        signingPrivateKeyPath: signingPem,
        sourceDirectory: source,
      });
      write(
        join(workspace, ".memtextual-release-validation.json"),
        `${JSON.stringify({
          candidateManifestSha256: candidate.manifestSha256,
          candidatePublisherFingerprint256:
            candidate.signingCertificateFingerprint256,
          formatVersion: 1,
          syntheticDataOnly: true,
        })}\n`,
      );
      const deployment = parseWindowsContinuityDeploymentConfiguration({
        applicationDirectory: candidate.bundleDirectory,
        backupDirectory,
        backupIntervalHours: 24,
        backupPollIntervalMinutes: 60,
        databasePath,
        formatVersion: 1,
        identityName: "MTValidateTest",
        stateDirectory: join(workspace, "host-validation-state"),
      });
      const operations = new FakeOperations();
      const common = {
        operations,
        plan: createWindowsContinuityDeploymentPlan(deployment),
        scheduleValidator: async (scheduleId: string) => {
          mkdirSync(join(backupDirectory, "memtextual-synthetic-snapshot"));
          return {
            lastRunTime: "2027-02-03T01:00:00.000Z",
            lastTaskResult: 0 as const,
            passed: true as const,
            scheduleId,
          };
        },
        workspaceDirectory: workspace,
      };
      write(join(backupDirectory, "must-start-empty.txt"), "occupied\n");
      await assert.rejects(
        previewWindowsElevatedHostValidation(common),
        /backup directory must be empty/u,
      );
      rmSync(join(backupDirectory, "must-start-empty.txt"));
      mkdirSync(join(workspace, "host-validation-state"));
      await assert.rejects(
        previewWindowsElevatedHostValidation(common),
        /state directory must not exist/u,
      );
      rmSync(join(workspace, "host-validation-state"), { recursive: true });
      const preview = await previewWindowsElevatedHostValidation(common);
      assert.match(preview.confirmation, /^VALIDATE-WINDOWS-HOST-[A-F0-9]{20}$/u);
      await assert.rejects(
        applyWindowsElevatedHostValidation({
          ...common,
          confirmation: "VALIDATE-WINDOWS-HOST-WRONG",
          context: { actorId: "test-user", explicitUserAction: true },
        }),
        /missing, incorrect, or stale/u,
      );
      const report = await applyWindowsElevatedHostValidation({
        ...common,
        confirmation: preview.confirmation,
        context: { actorId: "test-user", explicitUserAction: true },
      });
      assert.equal(report.passed, true);
      assert.equal(report.hostAccepted, true);
      assert.equal(report.hostRemoved, true);
      assert.equal(operations.identities.size, 0);
      assert.equal(operations.schedules.size, 0);
      assert.equal(existsSync(databasePath), true);
      assert.equal(existsSync(report.reportPath), true);
    } finally {
      rmSync(root, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
  });
});
