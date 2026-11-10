import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  openMemTextualDatabase,
  startContinuityRemoteRuntime,
  type ContinuityNodeHttpListenerOptions,
} from "../src/index.js";

test("Continuity remote runtime composes one loopback resource and closes owned resources", async () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  let captured: ContinuityNodeHttpListenerOptions | undefined;
  let listenerClosed = false;
  let runnerClosed = false;
  const runtime = await startContinuityRemoteRuntime({
    configuration: {
      formatVersion: 1,
      auth0Issuer: "https://memtextual-uat.us.auth0.com/",
      publicOrigin: "https://memory-uat.example.test/",
      port: 43_119,
      writeAuthorization: { mode: "deny" },
    },
    database,
    oauthMetadata: {
      issuer: "https://memtextual-uat.us.auth0.com/",
      authorization_endpoint: "https://memtextual-uat.us.auth0.com/authorize",
      token_endpoint: "https://memtextual-uat.us.auth0.com/oauth/token",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
    sensitivityModel: "gpt-test",
    sensitivityRunner: {
      runStructuredTask: () => Promise.reject(new Error("not called")),
      close: () => {
        runnerClosed = true;
        return Promise.resolve();
      },
    },
    startListener: (options) => {
      captured = options;
      return Promise.resolve({
        host: "127.0.0.1",
        port: 43_119,
        localOrigin: "http://127.0.0.1:43119",
        close: () => {
          listenerClosed = true;
          return Promise.resolve();
        },
      });
    },
  });
  try {
    assert.equal(runtime.localOrigin, "http://127.0.0.1:43119");
    assert.equal(runtime.resourceServerUrl.href, "https://memory-uat.example.test/mcp");
    assert.equal(captured?.port, 43_119);
    assert.equal(captured?.publicOrigin.href, "https://memory-uat.example.test/");
    const metadata = await captured?.application.fetch(
      new Request(
        "https://memory-uat.example.test/.well-known/oauth-protected-resource/mcp",
      ),
    );
    assert.equal(metadata?.status, 200);
  } finally {
    await runtime.close();
    database.close();
  }
  assert.equal(listenerClosed, true);
  assert.equal(runnerClosed, true);
});

test("Continuity remote runtime cleans up when listener startup fails", async () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  let runnerClosed = false;
  try {
    await assert.rejects(
      startContinuityRemoteRuntime({
        configuration: {
          formatVersion: 1,
          auth0Issuer: "https://memtextual-uat.us.auth0.com/",
          publicOrigin: "https://memory-uat.example.test/",
          port: 43_119,
          writeAuthorization: { mode: "deny" },
        },
        database,
        oauthMetadata: {
          issuer: "https://memtextual-uat.us.auth0.com/",
          authorization_endpoint: "https://memtextual-uat.us.auth0.com/authorize",
          token_endpoint: "https://memtextual-uat.us.auth0.com/oauth/token",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
        sensitivityModel: "gpt-test",
        sensitivityRunner: {
          runStructuredTask: () => Promise.reject(new Error("not called")),
          close: () => {
            runnerClosed = true;
            return Promise.resolve();
          },
        },
        startListener: () => Promise.reject(new Error("port unavailable")),
      }),
      /port unavailable/iu,
    );
    assert.equal(runnerClosed, true);
  } finally {
    database.close();
  }
});
