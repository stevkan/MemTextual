import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  WindowsDpapiConversationGrantStore,
  createWindowsPowerShellBridge,
  type WindowsPowerShellBridge,
  type WindowsPowerShellHostAction,
} from "../src/index.js";

class CapturingBridge implements WindowsPowerShellBridge {
  readonly calls: Array<{ action: WindowsPowerShellHostAction; payload: unknown }> = [];
  readonly responses: unknown[] = [];

  async execute(
    action: WindowsPowerShellHostAction,
    payload: unknown,
  ): Promise<unknown> {
    this.calls.push({ action, payload });
    if (this.responses.length === 0) throw new Error("Missing fake response.");
    return this.responses.shift();
  }
}

const binding = {
  authorizationId: "authorization-1",
  userId: "user-1",
  personaId: "persona-1",
  relationshipId: "relationship-1",
  hostId: "codex.app-server",
};
const grant = `mthg_${"a".repeat(43)}`;

test("Windows grant store sends secrets only through the protected bridge payload", async () => {
  const bridge = new CapturingBridge();
  bridge.responses.push(
    { authorizationId: binding.authorizationId, created: true, stored: true },
    { found: true, grant },
    { authorizationId: binding.authorizationId, deleted: true },
  );
  const store = new WindowsDpapiConversationGrantStore({ bridge });

  assert.deepEqual(await store.store({ ...binding, grant }), {
    authorizationId: binding.authorizationId,
    created: true,
  });
  assert.equal(await store.load(binding), grant);
  assert.equal(await store.delete(binding), true);
  assert.deepEqual(
    bridge.calls.map(({ action }) => action),
    [
      "store-conversation-grant",
      "load-conversation-grant",
      "delete-conversation-grant",
    ],
  );
  assert.equal(
    (bridge.calls[1]?.payload as Record<string, unknown>).grant,
    undefined,
  );
  assert.equal(
    (bridge.calls[2]?.payload as Record<string, unknown>).grant,
    undefined,
  );
});

test("Windows grant store rejects invalid grants, bindings, and bridge responses", async () => {
  const bridge = new CapturingBridge();
  const store = new WindowsDpapiConversationGrantStore({ bridge });
  await assert.rejects(
    store.store({ ...binding, grant: "not-a-grant" }),
    /grant value is invalid/u,
  );
  await assert.rejects(
    store.load({ ...binding, authorizationId: "../escape" }),
    /authorizationId is invalid/u,
  );
  bridge.responses.push({ found: true, grant: "not-a-grant" });
  await assert.rejects(store.load(binding), /lookup response is invalid/u);
});

test("Windows executor uses create-once CurrentUser DPAPI grant records", () => {
  const source = readFileSync(
    resolve("scripts", "windows-host-executor.ps1"),
    "utf8",
  );
  assert.match(source, /conversation-grant-\$AuthorizationId\.dpapi/u);
  assert.match(source, /DataProtectionScope\]::CurrentUser/u);
  assert.match(source, /\[IO\.FileMode\]::CreateNew/u);
  assert.match(source, /Unprotect-ConversationGrantBytes/u);
  assert.match(source, /Set-CurrentUserRestrictedFileAcl \$path/u);
  assert.match(source, /\[IO\.File\]::SetAccessControl/u);
});

test(
  "Windows DPAPI bridge round-trips and removes a protected grant",
  {
    skip:
      process.platform !== "win32" ||
      process.env.MEMTEXTUAL_WINDOWS_DPAPI_INTEGRATION !== "1",
  },
  async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "memtextual-grant-store-"));
    try {
      const store = new WindowsDpapiConversationGrantStore({
        bridge: createWindowsPowerShellBridge({
          scriptPath: resolve("scripts", "windows-host-executor.ps1"),
          stateDirectory: directory,
        }),
      });
      assert.deepEqual(await store.store({ ...binding, grant }), {
        authorizationId: binding.authorizationId,
        created: true,
      });
      assert.deepEqual(await store.store({ ...binding, grant }), {
        authorizationId: binding.authorizationId,
        created: false,
      });
      assert.equal(await store.load(binding), grant);
      assert.equal(await store.delete(binding), true);
      assert.equal(await store.load(binding), null);
    } finally {
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
