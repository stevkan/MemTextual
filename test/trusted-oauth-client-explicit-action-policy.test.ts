import assert from "node:assert/strict";
import test from "node:test";
import {
  TrustedOAuthClientExplicitActionPolicy,
  continuityMcpReadScope,
  continuityMcpWriteScope,
  type ContinuityMcpExplicitUserActionInput,
} from "../src/index.js";

const resource = new URL("https://memory.example.test/mcp");
const principal = {
  authenticationSubject: "identity-hash",
  continuityUserId: "continuity-user-id",
};

function input(
  overrides: Partial<ContinuityMcpExplicitUserActionInput> = {},
): ContinuityMcpExplicitUserActionInput {
  return {
    authInfo: {
      token: "test-token",
      clientId: "https://chatgpt.com/oauth/client.json",
      scopes: [continuityMcpReadScope, continuityMcpWriteScope],
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      resource,
    },
    principal,
    request: new Request(resource, { method: "POST" }),
    authorization: "explicit_user_write",
    ...overrides,
  };
}

test("trusted OAuth client policy accepts only an exact client with write scope", () => {
  const policy = new TrustedOAuthClientExplicitActionPolicy({
    trustedClientIds: ["https://chatgpt.com/oauth/client.json"],
  });
  assert.equal(policy.authorize(input()), true);
  assert.equal(
    policy.authorize(
      input({
        authInfo: {
          ...input().authInfo,
          clientId: "https://chatgpt.com/oauth/other-client.json",
        },
      }),
    ),
    false,
  );
  assert.equal(
    policy.authorize(
      input({
        authInfo: {
          ...input().authInfo,
          scopes: [continuityMcpReadScope],
        },
      }),
    ),
    false,
  );
});

test("trusted OAuth client policy binds approval to the exact MCP POST resource", () => {
  const policy = new TrustedOAuthClientExplicitActionPolicy({
    trustedClientIds: ["chatgpt-uat-client"],
  });
  const authorized = input({
    authInfo: { ...input().authInfo, clientId: "chatgpt-uat-client" },
  });
  assert.equal(policy.authorize(authorized), true);
  assert.equal(
    policy.authorize({
      ...authorized,
      request: new Request(resource, { method: "GET" }),
    }),
    false,
  );
  assert.equal(
    policy.authorize({
      ...authorized,
      request: new Request(`${resource.href}?unexpected=true`, {
        method: "POST",
      }),
    }),
    false,
  );
  assert.equal(
    policy.authorize({
      ...authorized,
      authInfo: {
        ...authorized.authInfo,
        resource: new URL("https://other.example.test/mcp"),
      },
    }),
    false,
  );
});

test("trusted OAuth client policy rejects ambiguous configuration", () => {
  assert.throws(
    () =>
      new TrustedOAuthClientExplicitActionPolicy({ trustedClientIds: [] }),
    /at least one/iu,
  );
  assert.throws(
    () =>
      new TrustedOAuthClientExplicitActionPolicy({
        trustedClientIds: ["chatgpt", "chatgpt"],
      }),
    /unique/iu,
  );
  assert.throws(
    () =>
      new TrustedOAuthClientExplicitActionPolicy({
        trustedClientIds: [" chatgpt"],
      }),
    /invalid/iu,
  );
});
