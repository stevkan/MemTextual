import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { Buffer } from "node:buffer";
import * as z from "zod/v4";

const maximumMetadataBytes = 256 * 1024;

const metadataSchema = z
  .object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    response_types_supported: z.array(z.string()),
    code_challenge_methods_supported: z.array(z.string()),
  })
  .loose();

export interface LoadAuth0OAuthMetadataOptions {
  issuer: string;
  fetch?: typeof globalThis.fetch;
}

function exactHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Auth0 ${label} is not a valid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.href !== value
  ) {
    throw new Error(`Auth0 ${label} must be an exact HTTPS URL.`);
  }
  return url;
}

export async function loadAuth0OAuthMetadata(
  options: LoadAuth0OAuthMetadataOptions,
): Promise<OAuthMetadata> {
  const issuer = exactHttpsUrl(options.issuer, "issuer");
  if (issuer.pathname !== "/") {
    throw new Error("Auth0 issuer must be an HTTPS origin ending with a slash.");
  }
  const fetch_ = options.fetch ?? globalThis.fetch;
  const discoveryUrl = new URL(".well-known/openid-configuration", issuer);
  let response: Response;
  try {
    response = await fetch_(discoveryUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error("Auth0 discovery could not be reached.");
  }
  if (!response.ok) {
    throw new Error(`Auth0 discovery returned HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumMetadataBytes) {
    throw new Error("Auth0 discovery metadata is too large.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Auth0 discovery returned invalid JSON.");
  }
  const result = metadataSchema.safeParse(decoded);
  if (!result.success) {
    throw new Error(
      `Auth0 discovery metadata failed validation: ${z.prettifyError(result.error)}`,
    );
  }
  if (result.data.issuer !== issuer.href) {
    throw new Error("Auth0 discovery issuer does not match the configured issuer.");
  }
  for (const [label, value] of [
    ["authorization endpoint", result.data.authorization_endpoint],
    ["token endpoint", result.data.token_endpoint],
  ] as const) {
    const endpoint = exactHttpsUrl(value, label);
    if (endpoint.origin !== issuer.origin) {
      throw new Error(`Auth0 ${label} must use the configured issuer origin.`);
    }
  }
  if (!result.data.response_types_supported.includes("code")) {
    throw new Error("Auth0 discovery does not advertise authorization code flow.");
  }
  if (!result.data.code_challenge_methods_supported.includes("S256")) {
    throw new Error("Auth0 discovery does not advertise PKCE S256.");
  }
  return result.data as OAuthMetadata;
}
