import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWindowsHostInstallation,
  applyWindowsHostRemoval,
  createWindowsHostIntegrationBundle,
  previewWindowsHostInstallation,
  previewWindowsHostRemoval,
  type HostScheduleDefinition,
  type HostServiceIdentityRequest,
  type HostServiceIdentityState,
  type WindowsHostIntegrationConfiguration,
  type WindowsHostOperations,
  type WindowsManagedScheduleState,
  type WindowsProtectedPath,
} from "../src/index.js";

class FakeWindowsHostOperations implements WindowsHostOperations {
  readonly calls: string[] = [];
  readonly identities = new Map<string, HostServiceIdentityState>();
  readonly schedules = new Map<string, WindowsManagedScheduleState>();
  failScheduleId: string | null = null;

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
    identityName: string,
  ): Promise<WindowsManagedScheduleState> {
    this.calls.push(`install:${definition.scheduleId}:${identityName}`);
    if (definition.scheduleId === this.failScheduleId) {
      throw new Error("simulated task registration failure");
    }
    const state: WindowsManagedScheduleState = {
      definition,
      enabled: true,
      installed: true,
      managedByMemTextual: true,
      scheduleId: definition.scheduleId,
    };
    this.schedules.set(definition.scheduleId, state);
    return state;
  }

  async protectPaths(
    paths: readonly WindowsProtectedPath[],
    identityName: string,
  ): Promise<void> {
    this.calls.push(`protect:${identityName}:${paths.length}`);
  }

  async provisionIdentity(
    request: HostServiceIdentityRequest,
  ): Promise<HostServiceIdentityState> {
    this.calls.push(`provision:${request.identityName}`);
    const state = {
      available: true,
      identityName: request.identityName,
      managedByMemTextual: true,
    };
    this.identities.set(request.identityName, state);
    return state;
  }

  async removeIdentity(identityName: string): Promise<HostServiceIdentityState> {
    this.calls.push(`remove-identity:${identityName}`);
    this.identities.delete(identityName);
    return {
      available: false,
      identityName,
      managedByMemTextual: false,
    };
  }

  async removeSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    this.calls.push(`remove:${scheduleId}`);
    this.schedules.delete(scheduleId);
    return {
      enabled: false,
      installed: false,
      managedByMemTextual: false,
      scheduleId,
    };
  }
}

const backupSchedule: HostScheduleDefinition = {
  command: {
    arguments: [
      "C:\\ProgramData\\MemTextual\\run-safeguard.ps1",
      "run-if-due",
    ],
    environmentVariableNames: [],
    executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    workingDirectory: "C:\\Program Files\\MemTextual",
  },
  intervalMinutes: 60,
  scheduleId: "MemTextual-Backup",
};

const replicationSchedule: HostScheduleDefinition = {
  command: {
    arguments: [
      "C:\\ProgramData\\MemTextual\\run-safeguard.ps1",
      "offsite-run-if-due",
    ],
    environmentVariableNames: ["MEMTEXTUAL_OFFSITE_KEY"],
    executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    workingDirectory: "C:\\Program Files\\MemTextual",
  },
  intervalMinutes: 1_440,
  scheduleId: "MemTextual-Offsite",
};

const configuration: WindowsHostIntegrationConfiguration = {
  formatVersion: 1,
  identity: {
    identityName: "MemTextualSvc",
    purpose: "Run MemTextual Continuity backup and encrypted replication tasks.",
  },
  protectedPaths: [
    {
      access: "read",
      path: "C:\\ProgramData\\MemTextual\\credentials",
    },
    {
      access: "read",
      path: "C:\\ProgramData\\MemTextual\\recovery-key.dpapi",
    },
  ],
  schedules: [backupSchedule, replicationSchedule],
};

const context = {
  actorId: "local-user",
  explicitUserAction: true as const,
};

describe("Windows host integration", () => {
  it("binds Windows adapters to one dedicated identity", async () => {
    const operations = new FakeWindowsHostOperations();
    const bundle = createWindowsHostIntegrationBundle(
      operations,
      "MemTextualSvc",
    );
    assert.equal(bundle.platform, "windows");
    await bundle.serviceIdentity?.provision(configuration.identity, context);
    await bundle.scheduler?.install(backupSchedule, context);
    assert.deepEqual(operations.calls, [
      "provision:MemTextualSvc",
      "install:MemTextual-Backup:MemTextualSvc",
    ]);
  });

  it("requires a fresh preview-bound confirmation and preserves data on removal", async () => {
    const operations = new FakeWindowsHostOperations();
    const preview = await previewWindowsHostInstallation(
      operations,
      configuration,
    );
    assert.match(preview.confirmation, /^INSTALL-WINDOWS-HOST-[A-F0-9]{20}$/u);
    assert.equal(preview.identityWillBeProvisioned, true);
    assert.deepEqual(preview.schedulesWillBeInstalled, [
      "MemTextual-Backup",
      "MemTextual-Offsite",
    ]);
    await assert.rejects(
      applyWindowsHostInstallation(
        operations,
        configuration,
        "INSTALL-WINDOWS-HOST-WRONG",
        context,
      ),
      /missing, incorrect, or stale/u,
    );
    const installed = await applyWindowsHostInstallation(
      operations,
      configuration,
      preview.confirmation,
      context,
    );
    assert.equal(installed.identity.managedByMemTextual, true);
    assert.equal(installed.installedSchedules.length, 2);

    const removalPreview = await previewWindowsHostRemoval(
      operations,
      configuration,
    );
    assert.deepEqual(
      removalPreview.dataPathsPreserved,
      configuration.protectedPaths,
    );
    const removed = await applyWindowsHostRemoval(
      operations,
      configuration,
      removalPreview.confirmation,
      context,
    );
    assert.equal(removed.identity.available, false);
    assert.deepEqual(removed.preservedDataPaths, configuration.protectedPaths);
    assert.equal(removed.removedSchedules.length, 2);
    assert.equal(
      operations.calls.some((call) => call.startsWith("delete-data:")),
      false,
    );
  });

  it("rolls back newly created tasks and identity after installation failure", async () => {
    const operations = new FakeWindowsHostOperations();
    operations.failScheduleId = "MemTextual-Offsite";
    const preview = await previewWindowsHostInstallation(
      operations,
      configuration,
    );
    await assert.rejects(
      applyWindowsHostInstallation(
        operations,
        configuration,
        preview.confirmation,
        context,
      ),
      /failed and was rolled back.*simulated task registration failure/u,
    );
    assert.equal(
      (await operations.inspectIdentity("MemTextualSvc")).available,
      false,
    );
    assert.equal(
      (await operations.inspectSchedule("MemTextual-Backup")).installed,
      false,
    );
    assert.deepEqual(operations.calls.slice(-2), [
      "remove:MemTextual-Backup",
      "remove-identity:MemTextualSvc",
    ]);
  });

  it("refuses to replace or remove identities and schedules it does not own", async () => {
    const operations = new FakeWindowsHostOperations();
    operations.identities.set("MemTextualSvc", {
      available: true,
      identityName: "MemTextualSvc",
      managedByMemTextual: false,
    });
    await assert.rejects(
      previewWindowsHostInstallation(operations, configuration),
      /not managed by MemTextual/u,
    );
    operations.identities.clear();
    operations.schedules.set("MemTextual-Backup", {
      definition: { ...backupSchedule, intervalMinutes: 5 },
      enabled: true,
      installed: true,
      managedByMemTextual: false,
      scheduleId: "MemTextual-Backup",
    });
    await assert.rejects(
      previewWindowsHostRemoval(operations, configuration),
      /not the MemTextual definition and will not be removed/u,
    );
  });

  it("rejects secrets in task arguments and implicit mutations", async () => {
    const operations = new FakeWindowsHostOperations();
    const bundle = createWindowsHostIntegrationBundle(
      operations,
      "MemTextualSvc",
    );
    await assert.rejects(
      bundle.scheduler!.install(
        {
          ...backupSchedule,
          command: {
            ...backupSchedule.command,
            arguments: ["--client-secret=not-allowed"],
          },
        },
        context,
      ),
      /secret material/u,
    );
    await assert.rejects(
      bundle.scheduler!.remove("MemTextual-Backup", {
        actorId: "local-user",
        explicitUserAction: false,
      } as never),
      /requires an explicit user action/u,
    );
  });
});
