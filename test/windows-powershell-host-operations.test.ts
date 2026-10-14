import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  WindowsPowerShellHostOperations,
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
    assert.doesNotMatch(source, /Write-(?:Host|Output)/u);
  });
});
