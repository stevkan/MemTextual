import assert from "node:assert/strict";
import test from "node:test";
import { startContinuityNodeHttpListener } from "../src/index.js";

test("Continuity node HTTP listener binds loopback and reconstructs only the configured public origin", async () => {
  const seen: Request[] = [];
  const listener = await startContinuityNodeHttpListener({
    application: {
      async fetch(request) {
        seen.push(request);
        return Response.json({ url: request.url, method: request.method });
      },
    },
    publicOrigin: new URL("https://memory.example.test/"),
  });
  try {
    assert.equal(listener.host, "127.0.0.1");
    const response = await fetch(`${listener.localOrigin}/mcp?test=value`, {
      method: "POST",
      headers: {
        authorization: "Bearer bounded-test-token",
        host: "untrusted.example.test",
        forwarded: "host=untrusted.example.test;proto=http",
        "x-forwarded-for": "203.0.113.5",
      },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: "https://memory.example.test/mcp?test=value",
      method: "POST",
    });
    assert.equal(seen[0]?.headers.get("authorization"), "Bearer bounded-test-token");
    assert.equal(seen[0]?.headers.get("host"), null);
    assert.equal(seen[0]?.headers.get("forwarded"), null);
    assert.equal(seen[0]?.headers.get("x-forwarded-for"), null);
  } finally {
    await listener.close();
  }
});

test("Continuity node HTTP listener rejects oversized bodies before application handling", async () => {
  let called = false;
  const listener = await startContinuityNodeHttpListener({
    application: {
      fetch() {
        called = true;
        return Promise.resolve(new Response("unexpected"));
      },
    },
    publicOrigin: new URL("https://memory.example.test/"),
    maximumRequestBytes: 4,
  });
  try {
    const response = await fetch(`${listener.localOrigin}/mcp`, {
      method: "POST",
      body: "12345",
    });
    assert.equal(response.status, 413);
    assert.equal(called, false);
  } finally {
    await listener.close();
  }
});

test("Continuity node HTTP listener validates its public and local configuration", async () => {
  const application = {
    fetch: () => Promise.resolve(new Response("ok")),
  };
  await assert.rejects(
    startContinuityNodeHttpListener({
      application,
      publicOrigin: new URL("http://memory.example.test/"),
    }),
    /HTTPS origin/iu,
  );
  await assert.rejects(
    startContinuityNodeHttpListener({
      application,
      publicOrigin: new URL("https://memory.example.test/path"),
    }),
    /HTTPS origin/iu,
  );
  await assert.rejects(
    startContinuityNodeHttpListener({
      application,
      publicOrigin: new URL("https://memory.example.test/"),
      port: 70_000,
    }),
    /port/iu,
  );
});
