import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createWindowsPowerShellBridge } from "../src/index.js";

test(
  "Windows host inspection fails closed when protected state outlives a hidden resource",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "memtextual-host-inspection-"));
    const suffix = randomBytes(4).toString("hex");
    const identityName = `MtProbe${suffix}`;
    const scheduleId = `MemTextual-Probe-${suffix}`;
    const identityStatePath = join(directory, `identity-${identityName}.dpapi`);
    const scheduleStatePath = join(directory, `schedule-${scheduleId}.json`);
    const bridge = createWindowsPowerShellBridge({
      scriptPath: resolve("scripts", "windows-host-executor.ps1"),
      stateDirectory: directory,
    });

    try {
      writeFileSync(identityStatePath, "managed identity sentinel", "utf8");
      await assert.rejects(
        bridge.execute("inspect-identity", { identityName }),
        /Windows identity inspection (?:cannot report the identity as absent while managed identity state exists|could not access local account state)/u,
      );
      unlinkSync(identityStatePath);
      try {
        assert.deepEqual(await bridge.execute("inspect-identity", { identityName }), {
          available: false,
          identityName,
          managedByMemTextual: false,
        });
      } catch (error) {
        assert.match(
          String(error),
          /Windows identity inspection could not access local account state/u,
        );
      }

      writeFileSync(scheduleStatePath, "managed schedule sentinel", "utf8");
      await assert.rejects(
        bridge.execute("inspect-schedule", { scheduleId }),
        /Windows schedule inspection (?:cannot report the schedule as absent while managed schedule state exists|could not access Task Scheduler state)/u,
      );
      unlinkSync(scheduleStatePath);
      try {
        assert.deepEqual(await bridge.execute("inspect-schedule", { scheduleId }), {
          enabled: false,
          installed: false,
          managedByMemTextual: false,
          scheduleId,
        });
      } catch (error) {
        assert.match(
          String(error),
          /Windows schedule inspection could not access Task Scheduler state/u,
        );
      }
    } finally {
      rmSync(directory, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
  },
);
