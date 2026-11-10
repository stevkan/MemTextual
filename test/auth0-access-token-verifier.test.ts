import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import test from "node:test";
import {
  SignJWT,
  exportJWK,
  type FetchImplementation,
  type JWTPayload,
} from "jose";
import {
  Auth0AccessTokenVerifier,
  Auth0VerifiedIdentityExtractor,
  continuityMcpReadScope,
  continuityMcpWriteScope,
} from "../src/index.js";

const issuer = "https://memtextual-uat.us.auth0.com/";
const resourceServerUrl = new URL("https://continuity-uat.example.test/mcp");

async function fixture() {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = await exportJWK(keys.publicKey);
  const keyId = "auth0-uat-key";
  let fetchCount = 0;
  const fetch: FetchImplementation = async (url) => {
    fetchCount += 1;
    assert.equal(url, `${issuer}.well-known/jwks.json`);
    return Response.json({
      keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }],
    });
  };
  const verifier = new Auth0AccessTokenVerifier({
    issuer,
    resourceServerUrl,
    fetch,
  });

  async function token(
    overrides: JWTPayload & { azp?: string; scope?: string } = {},
    signingKey: KeyObject = keys.privateKey,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "auth0|steve-uat",
      azp: "chatgpt-uat-client",
      scope: `${continuityMcpReadScope} ${continuityMcpWriteScope}`,
      ...overrides,
    };
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "JWT" })
      .setIssuer(overrides.iss ?? issuer)
      .setAudience(overrides.aud ?? resourceServerUrl.href)
      .setIssuedAt(overrides.iat ?? now)
      .setExpirationTime(overrides.exp ?? now + 600)
      .sign(signingKey);
  }

  return { fetchCount: () => fetchCount, token, verifier };
}

test("Auth0 verifier validates RS256 tokens and exposes only bounded identity claims", async () => {
  const setup = await fixture();
  const accessToken = await setup.token();
  const info = await setup.verifier.verifyAccessToken(accessToken);

  assert.equal(info.token, accessToken);
  assert.equal(info.clientId, "chatgpt-uat-client");
  assert.deepEqual(info.scopes, [continuityMcpReadScope, continuityMcpWriteScope]);
  assert.equal(info.resource?.href, resourceServerUrl.href);
  assert.deepEqual(info.extra, {
    issuer,
    subject: "auth0|steve-uat",
  });
  assert.equal(JSON.stringify(info.extra).includes("scope"), false);

  await setup.verifier.verifyAccessToken(await setup.token({ sub: "auth0|second" }));
  assert.equal(setup.fetchCount(), 1);
});

test("Auth0 verifier rejects wrong issuer, audience, expiry, signature, and malformed claims", async () => {
  const setup = await fixture();
  const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const invalidTokens = [
    await setup.token({ iss: "https://other.auth0.com/" }),
    await setup.token({ aud: "https://other.example.test/mcp" }),
    await setup.token({ exp: Math.floor(Date.now() / 1000) - 60 }),
    await setup.token({}, otherKeys.privateKey),
    await setup.token({ sub: "" }),
    await setup.token({ azp: "" }),
    await setup.token({ scope: 4 as unknown as string }),
  ];

  for (const accessToken of invalidTokens) {
    await assert.rejects(
      setup.verifier.verifyAccessToken(accessToken),
      /access token is invalid/iu,
    );
  }
});

test("Auth0 verifier validates configuration and identity extraction", async () => {
  assert.throws(
    () =>
      new Auth0AccessTokenVerifier({
        issuer: "http://memtextual-uat.auth0.com/",
        resourceServerUrl,
      }),
    /exact HTTPS origin/iu,
  );
  assert.throws(
    () =>
      new Auth0AccessTokenVerifier({
        issuer: "https://memtextual-uat.auth0.com/path",
        resourceServerUrl,
      }),
    /exact HTTPS origin/iu,
  );
  assert.throws(
    () =>
      new Auth0AccessTokenVerifier({
        issuer,
        resourceServerUrl: new URL("http://continuity.example.test/mcp"),
      }),
    /resource server URL/iu,
  );

  const extractor = new Auth0VerifiedIdentityExtractor(issuer);
  assert.deepEqual(
    extractor.extract({
      token: "bounded-test-token",
      clientId: "chatgpt-uat-client",
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      extra: { issuer, subject: "auth0|steve-uat" },
    }),
    { issuer, subject: "auth0|steve-uat" },
  );
  assert.throws(
    () =>
      extractor.extract({
        token: "bounded-test-token",
        clientId: "chatgpt-uat-client",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        extra: {
          issuer: "https://other.auth0.com/",
          subject: "auth0|steve-uat",
        },
      }),
    /claims are unavailable/iu,
  );
});
