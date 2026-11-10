import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type FetchImplementation,
} from "jose";
import type { ContinuityVerifiedIdentity } from "../domain/continuity-identity.js";
import type { ContinuityVerifiedIdentityExtractor } from "./continuity-bound-principal-resolver.js";

const maximumAccessTokenLength = 16_384;

export interface Auth0AccessTokenVerifierOptions {
  issuer: string;
  resourceServerUrl: URL;
  fetch?: FetchImplementation;
}

function validateIssuer(issuer: string): URL {
  if (issuer !== issuer.trim() || issuer.length === 0 || issuer.length > 2048) {
    throw new Error("The Auth0 issuer is invalid.");
  }
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error("The Auth0 issuer is invalid.");
  }
  if (
    issuerUrl.protocol !== "https:" ||
    issuerUrl.username !== "" ||
    issuerUrl.password !== "" ||
    issuerUrl.pathname !== "/" ||
    issuerUrl.search !== "" ||
    issuerUrl.hash !== "" ||
    issuerUrl.href !== issuer
  ) {
    throw new Error(
      "The Auth0 issuer must be an exact HTTPS origin ending with a slash.",
    );
  }
  return issuerUrl;
}

function validateResourceServerUrl(resourceServerUrl: URL): URL {
  const normalized = new URL(resourceServerUrl.href);
  if (
    normalized.protocol !== "https:" ||
    normalized.username !== "" ||
    normalized.password !== "" ||
    normalized.search !== "" ||
    normalized.hash !== ""
  ) {
    throw new Error(
      "The Auth0 resource server URL must be an HTTPS URL without credentials, a query, or a fragment.",
    );
  }
  return normalized;
}

function parseScopes(scope: unknown): string[] {
  if (scope === undefined) {
    return [];
  }
  if (typeof scope !== "string" || scope.length > 4096) {
    throw new Error("The Auth0 access-token scope claim is invalid.");
  }
  return [...new Set(scope.split(" ").filter((value) => value.length > 0))];
}

function parseClientId(payload: Record<string, unknown>): string {
  const clientId = payload["azp"] ?? payload["client_id"];
  if (
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    clientId.length > 1024 ||
    clientId !== clientId.trim()
  ) {
    throw new Error("The Auth0 access token does not identify its client.");
  }
  return clientId;
}

function invalidToken(): OAuthError {
  return new OAuthError(
    OAuthErrorCode.InvalidToken,
    "The access token is invalid.",
  );
}

export class Auth0AccessTokenVerifier implements OAuthTokenVerifier {
  private readonly issuerUrl: URL;
  private readonly resourceServerUrl: URL;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  public constructor(options: Auth0AccessTokenVerifierOptions) {
    this.issuerUrl = validateIssuer(options.issuer);
    this.resourceServerUrl = validateResourceServerUrl(
      options.resourceServerUrl,
    );
    this.jwks = createRemoteJWKSet(
      new URL(".well-known/jwks.json", this.issuerUrl),
      {
        timeoutDuration: 5000,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
        ...(options.fetch === undefined
          ? {}
          : { [customFetch]: options.fetch }),
      },
    );
  }

  public async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (
      token.length === 0 ||
      token.length > maximumAccessTokenLength ||
      token !== token.trim()
    ) {
      throw invalidToken();
    }
    try {
      const result = await jwtVerify(token, this.jwks, {
        algorithms: ["RS256"],
        issuer: this.issuerUrl.href,
        audience: this.resourceServerUrl.href,
        requiredClaims: ["sub", "exp", "iat"],
      });
      const issuer = result.payload.iss;
      const subject = result.payload.sub;
      const expiresAt = result.payload.exp;
      if (
        issuer !== this.issuerUrl.href ||
        typeof subject !== "string" ||
        subject.length === 0 ||
        subject.length > 1024 ||
        subject !== subject.trim() ||
        typeof expiresAt !== "number" ||
        !Number.isSafeInteger(expiresAt)
      ) {
        throw new Error("The Auth0 access-token identity claims are invalid.");
      }
      const payload = result.payload as Record<string, unknown>;
      return {
        token,
        clientId: parseClientId(payload),
        scopes: parseScopes(payload["scope"]),
        expiresAt,
        resource: new URL(this.resourceServerUrl.href),
        extra: { issuer, subject },
      };
    } catch {
      throw invalidToken();
    }
  }
}

export class Auth0VerifiedIdentityExtractor
  implements ContinuityVerifiedIdentityExtractor
{
  private readonly issuer: string;

  public constructor(issuer: string) {
    this.issuer = validateIssuer(issuer).href;
  }

  public extract(authInfo: AuthInfo): ContinuityVerifiedIdentity {
    const issuer = authInfo.extra?.["issuer"];
    const subject = authInfo.extra?.["subject"];
    if (
      issuer !== this.issuer ||
      typeof subject !== "string" ||
      subject.length === 0
    ) {
      throw new Error("Verified Auth0 identity claims are unavailable.");
    }
    return { issuer, subject };
  }
}
