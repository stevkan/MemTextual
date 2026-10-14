import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectHostPlatform,
  hostPlatforms,
  type ExplicitHostMutationContext,
  type HostIntegrationBundle,
  type HostSchedulerAdapter,
} from "../src/platform/host-platform.js";

describe("host-platform boundary", () => {
  it("maps Node platform names to product platform names", () => {
    assert.equal(detectHostPlatform("win32"), "windows");
    assert.equal(detectHostPlatform("darwin"), "macos");
    assert.equal(detectHostPlatform("linux"), "linux");
    assert.equal(detectHostPlatform("freebsd"), "unsupported");
    assert.deepEqual(hostPlatforms, ["windows", "macos", "linux"]);
  });

  it("requires explicit user action for scheduler mutations", async () => {
    const observedContexts: ExplicitHostMutationContext[] = [];
    const scheduler: HostSchedulerAdapter = {
      identity: {
        adapterId: "test-scheduler",
        adapterVersion: "1",
        platform: "linux",
      },
      async inspect(scheduleId) {
        return { scheduleId, installed: false, enabled: false };
      },
      async install(definition, context) {
        observedContexts.push(context);
        return {
          scheduleId: definition.scheduleId,
          installed: true,
          enabled: true,
          definition,
        };
      },
      async remove(scheduleId, context) {
        observedContexts.push(context);
        return { scheduleId, installed: false, enabled: false };
      },
    };
    const bundle: HostIntegrationBundle = {
      platform: "linux",
      scheduler,
    };
    const context: ExplicitHostMutationContext = {
      actorId: "user-1",
      explicitUserAction: true,
    };

    await bundle.scheduler?.install(
      {
        scheduleId: "daily-backup",
        intervalMinutes: 1_440,
        command: {
          executablePath: "/opt/memtextual/bin/memtextual-safeguard",
          arguments: ["run-if-due"],
          workingDirectory: "/var/lib/memtextual",
          environmentVariableNames: ["MEMTEXTUAL_OFFSITE_KEY"],
        },
      },
      context,
    );
    await bundle.scheduler?.remove("daily-backup", context);

    assert.deepEqual(observedContexts, [context, context]);
  });
});
