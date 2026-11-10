import assert from "node:assert/strict";
import test from "node:test";
import { loadAuth0OAuthMetadata } from "../src/index.js";

const issuer = "https://memtextual-uat.us.auth0.com/";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer,
    authorization_endpoint: `${issuer}authorize`,
    token_endpoint: `${issuer}oauth/token`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    ...overrides,
  };
}

test("Auth0 discovery loader validates and preserves provider metadata", async () => {
  let requested: URL | undefined;
  const result = await loadAuth0OAuthMetadata({
    issuer,
    fetch: (input) => {
      requested = new URL(input instanceof Request ? input.url : input);
      return Promise.resolve(Response.json(metadata()));
    },
  });
  assert.equal(
    requested?.href,
    `${issuer}.well-known/openid-configuration`,
  );
  assert.equal(result.issuer, issuer);
  assert.deepEqual(result.token_endpoint_auth_methods_supported, [
    "none",
    "private_key_jwt",
  ]);
});

test("Auth0 discovery loader rejects issuer, endpoint, flow, and PKCE mismatches", async () => {
  for (const value of [
    metadata({ issuer: "https://other.auth0.com/" }),
    metadata({ authorization_endpoint: "https://other.auth0.com/authorize" }),
    metadata({ response_types_supported: ["token"] }),
    metadata({ code_challenge_methods_supported: ["plain"] }),
  ]) {
    await assert.rejects(
      loadAuth0OAuthMetadata({
        issuer,
        fetch: () => Promise.resolve(Response.json(value)),
      }),
      /Auth0/iu,
    );
  }
});

test("Auth0 discovery loader fails closed for transport and malformed responses", async () => {
  await assert.rejects(
    loadAuth0OAuthMetadata({
      issuer,
      fetch: () => Promise.reject(new Error("offline")),
    }),
    /could not be reached/iu,
  );
  await assert.rejects(
    loadAuth0OAuthMetadata({
      issuer,
      fetch: () => Promise.resolve(new Response("no", { status: 503 })),
    }),
    /503/iu,
  );
  await assert.rejects(
    loadAuth0OAuthMetadata({
      issuer,
      fetch: () => Promise.resolve(new Response("{")),
    }),
    /invalid JSON/iu,
  );
});
