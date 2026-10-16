import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWindowsMsiHostActionArguments } from "../src/cli/windows-msi-host-action.js";
import {
  executeWindowsMsiHostAction,
  type HostScheduleDefinition,
  type HostServiceIdentityRequest,
  type HostServiceIdentityState,
  type WindowsHostIntegrationConfiguration,
  type WindowsHostOperations,
  type WindowsManagedScheduleState,
  type WindowsPathProtectionState,
  type WindowsPathRestorationState,
  type WindowsProtectedPath,
} from "../src/index.js";

class FakeOperations implements WindowsHostOperations {
  identity = false;
  schedule = false;
  scheduledDefinition: HostScheduleDefinition | undefined;
  readonly calls: string[] = [];
  async inspectIdentity(identityName: string): Promise<HostServiceIdentityState> {
    return { available: this.identity, identityName, managedByMemTextual: this.identity };
  }
  async inspectSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    return {
      ...(this.scheduledDefinition === undefined ? {} : { definition: this.scheduledDefinition }),
      enabled: this.schedule, installed: this.schedule, managedByMemTextual: this.schedule, scheduleId,
    };
  }
  async installSchedule(definition: HostScheduleDefinition): Promise<WindowsManagedScheduleState> {
    this.calls.push("install-schedule"); this.schedule = true; this.scheduledDefinition = definition;
    return { definition, enabled: true, installed: true, managedByMemTextual: true, scheduleId: definition.scheduleId };
  }
  async protectPaths(_paths: readonly WindowsProtectedPath[]): Promise<WindowsPathProtectionState> {
    this.calls.push("protect"); return { created: true, protected: true };
  }
  async provisionIdentity(request: HostServiceIdentityRequest): Promise<HostServiceIdentityState> {
    this.calls.push("provision"); this.identity = true;
    return { available: true, identityName: request.identityName, managedByMemTextual: true };
  }
  async removeIdentity(identityName: string): Promise<HostServiceIdentityState> {
    this.calls.push("remove-identity"); this.identity = false;
    return { available: false, identityName, managedByMemTextual: false };
  }
  async removeSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    this.calls.push("remove-schedule"); this.schedule = false; this.scheduledDefinition = undefined;
    return { enabled: false, installed: false, managedByMemTextual: false, scheduleId };
  }
  async restorePaths(): Promise<WindowsPathRestorationState> {
    this.calls.push("restore"); return { restored: true };
  }
}

const configuration: WindowsHostIntegrationConfiguration = {
  formatVersion: 1,
  identity: { identityName: "MemTextualSvc", purpose: "Run Continuity backups." },
  protectedPaths: [{ access: "modify", mode: "grant", path: "C:\\ProgramData\\MemTextual Continuity\\data" }],
  schedules: [{
    command: {
      arguments: ["C:\\Program Files\\MemTextual\\Continuity\\dist\\src\\cli\\safeguard.js", "run-if-due"],
      environmentVariableNames: [], executablePath: "C:\\Program Files\\MemTextual\\Continuity\\runtime\\node.exe",
      workingDirectory: "C:\\Program Files\\MemTextual\\Continuity",
    },
    intervalMinutes: 60,
    scheduleId: "MemTextual-Continuity-Backup",
  }],
};

describe("Windows MSI host actions", () => {
  it("installs, rolls back installation, uninstalls, and rolls back uninstall through owned operations", async () => {
    const operations = new FakeOperations();
    assert.equal((await executeWindowsMsiHostAction({ action: "install", configuration, operations })).operation, "install");
    assert.equal((await executeWindowsMsiHostAction({ action: "rollback-install", configuration, operations })).operation, "remove");
    await executeWindowsMsiHostAction({ action: "install", configuration, operations });
    assert.equal((await executeWindowsMsiHostAction({ action: "uninstall", configuration, operations })).operation, "remove");
    assert.equal((await executeWindowsMsiHostAction({ action: "rollback-uninstall", configuration, operations })).operation, "install");
    assert.deepEqual(operations.calls, [
      "provision", "protect", "install-schedule", "remove-schedule", "restore", "remove-identity",
      "provision", "protect", "install-schedule", "remove-schedule", "restore", "remove-identity",
      "provision", "protect", "install-schedule",
    ]);
  });

  it("requires one known action and one configuration path", () => {
    assert.deepEqual(parseWindowsMsiHostActionArguments(["install", "--config", "C:\\deployment.json"]), {
      action: "install", configurationPath: "C:\\deployment.json",
    });
    assert.throws(() => parseWindowsMsiHostActionArguments(["unknown", "--config", "C:\\deployment.json"]), /Unknown or missing/u);
    assert.throws(() => parseWindowsMsiHostActionArguments(["install"]), /requires exactly/u);
  });
});
