import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  WindowsPowerShellHostOperations,
  validateWindowsManagedSchedule,
  type HostScheduleDefinition,
  type WindowsPowerShellBridge,
  type WindowsPowerShellHostAction,
} from "../src/index.js";

class CapturingBridge implements WindowsPowerShellBridge {
  readonly calls: Array<{ action: WindowsPowerShellHostAction; payload: unknown }> = [];
  readonly responses = new Map<WindowsPowerShellHostAction, unknown>();

  async execute(
    action: WindowsPowerShellHostAction,
    payload: unknown,
  ): Promise<unknown> {
    this.calls.push({ action, payload });
    const response = this.responses.get(action);
    if (response === undefined) throw new Error(`Missing fake response: ${action}`);
    return response;
  }
}

const definition: HostScheduleDefinition = {
  command: {
    arguments: ["dist/src/cli/safeguard.js", "offsite-run-if-due"],
    environmentVariableNames: ["MEMTEXTUAL_OFFSITE_KEY"],
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    workingDirectory: "C:\\Program Files\\MemTextual",
  },
  intervalMinutes: 1_440,
  scheduleId: "MemTextual-Offsite",
};

describe("Windows PowerShell host operations", () => {
  it("passes scheduled secret values only through the bridge payload", async () => {
    const bridge = new CapturingBridge();
    bridge.responses.set("install-schedule", {
      definition,
      enabled: true,
      installed: true,
      managedByMemTextual: true,
      scheduleId: definition.scheduleId,
    });
    const operations = new WindowsPowerShellHostOperations({
      bridge,
      environment: {
        MEMTEXTUAL_OFFSITE_KEY: "test-secret-value",
      },
    });
    const state = await operations.installSchedule(definition, "MemTextualSvc");
    assert.equal(state.managedByMemTextual, true);
    assert.deepEqual(bridge.calls, [
      {
        action: "install-schedule",
        payload: {
          definition,
          environmentValues: {
            MEMTEXTUAL_OFFSITE_KEY: "test-secret-value",
          },
          identityName: "MemTextualSvc",
        },
      },
    ]);
    assert.equal(
      JSON.stringify(definition).includes("test-secret-value"),
      false,
    );
  });

  it("fails before invoking PowerShell when a scheduled secret is unavailable", async () => {
    const bridge = new CapturingBridge();
    const operations = new WindowsPowerShellHostOperations({
      bridge,
      environment: {},
    });
    await assert.rejects(
      operations.installSchedule(definition, "MemTextualSvc"),
      /Required scheduled environment variable is not set/u,
    );
    assert.equal(bridge.calls.length, 0);
  });

  it("validates every privileged executor response", async () => {
    const bridge = new CapturingBridge();
    bridge.responses.set("inspect-identity", {
      available: "yes",
      identityName: "MemTextualSvc",
      managedByMemTextual: false,
    });
    const operations = new WindowsPowerShellHostOperations({ bridge });
    await assert.rejects(
      operations.inspectIdentity("MemTextualSvc"),
      /identity response is invalid/u,
    );
  });

  it("requires explicit protection and restoration receipts", async () => {
    const bridge = new CapturingBridge();
    bridge.responses.set("protect-paths", { created: true, protected: true });
    bridge.responses.set("restore-paths", { restored: true });
    const operations = new WindowsPowerShellHostOperations({ bridge });
    const paths = [
      { access: "read" as const, mode: "grant" as const, path: "C:\\MemTextual" },
    ];
    assert.deepEqual(
      await operations.protectPaths(paths, "MemTextualSvc"),
      { created: true, protected: true },
    );
    assert.deepEqual(
      await operations.restorePaths(paths, "MemTextualSvc"),
      { restored: true },
    );
  });

  it("validates an explicitly run managed schedule receipt", async () => {
    const bridge = new CapturingBridge();
    bridge.responses.set("validate-schedule", {
      lastRunTime: "2027-02-03T01:02:03.000Z",
      lastTaskResult: 0,
      passed: true,
      scheduleId: "MemTextual-Backup",
    });
    assert.deepEqual(
      await validateWindowsManagedSchedule(bridge, "MemTextual-Backup"),
      {
        lastRunTime: "2027-02-03T01:02:03.000Z",
        lastTaskResult: 0,
        passed: true,
        scheduleId: "MemTextual-Backup",
      },
    );
  });

  it("keeps the executor protocol on stdin and reserves stdout for JSON", () => {
    const source = readFileSync(
      resolve("scripts", "windows-host-executor.ps1"),
      "utf8",
    );
    assert.match(source, /\[Console\]::In\.ReadToEnd\(\)/u);
    assert.match(source, /\[Console\]::Out\.Write/u);
    assert.match(source, /\[Console\]::Error\.WriteLine/u);
    assert.match(source, /ProtectedData\]::Protect/u);
    assert.match(source, /Register-ScheduledTask/u);
    assert.match(source, /Windows DPAPI self-test did not round-trip/u);
    assert.match(source, /Start-ScheduledTask/u);
    assert.match(source, /protected-path-acls\.json/u);
    assert.match(source, /AccessControlSections\]::Access/u);
    assert.match(source, /RawSecurityDescriptor/u);
    assert.match(source, /DiscretionaryAclAutoInherited/u);
    assert.match(source, /Assert-FileSystemAccessAclRestored/u);
    assert.match(source, /Directory\]::SetAccessControl/u);
    assert.match(source, /File\]::SetAccessControl/u);
    assert.match(source, /Directory\]::GetAccessControl/u);
    assert.match(source, /File\]::GetAccessControl/u);
    assert.match(source, /ConvertTo-ReadOnlySecureString/u);
    assert.match(source, /Get-FileSha256/u);
    assert.match(source, /Security\.Cryptography\.SHA256\]::Create/u);
    assert.doesNotMatch(source, /Set-Acl/u);
    assert.doesNotMatch(source, /Get-Acl/u);
    assert.doesNotMatch(source, /Get-FileHash/u);
    assert.doesNotMatch(source, /ConvertTo-SecureString/u);
    assert.doesNotMatch(source, /RepetitionDuration/u);
    assert.doesNotMatch(source, /TimeSpan\]::MaxValue/u);
    assert.match(source, /\$accountName = "\$env:COMPUTERNAME\\\$identityName"/u);
    assert.doesNotMatch(source, /-UserId "\.\\\$identityName"/u);
    assert.match(source, /SeBatchLogonRight/u);
    assert.match(source, /LsaAddAccountRights/u);
    assert.match(source, /LsaRemoveAccountRights/u);
    assert.match(source, /identity provisioning failed and cleanup was incomplete/u);
    assert.match(source, /\$taskStillRunningResult = 0x00041301/u);
    assert.match(source, /LastTaskResult -ne \$taskStillRunningResult/u);
    assert.match(source, /\$maximumIdentityDescriptionLength = 48/u);
    assert.match(
      source,
      /Substring\(0, \$maximumIdentityDescriptionLength\)/u,
    );
    assert.doesNotMatch(source, /Write-(?:Host|Output)/u);
  });
});
