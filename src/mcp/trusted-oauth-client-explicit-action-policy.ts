import { continuityMcpWriteScope } from "./continuity-contract.js";
import type {
  ContinuityMcpExplicitUserActionInput,
  ContinuityMcpExplicitUserActionPolicy,
} from "./continuity-http.js";

export interface TrustedOAuthClientExplicitActionPolicyOptions {
  trustedClientIds: readonly string[];
}

function validateClientId(clientId: string): string {
  if (
    clientId.length === 0 ||
    clientId.length > 2048 ||
    clientId !== clientId.trim() ||
    /[\u0000-\u001f\u007f]/u.test(clientId)
  ) {
    throw new Error("A trusted OAuth client ID is invalid.");
  }
  return clientId;
}

function sameResource(request: Request, resource: URL | undefined): boolean {
  if (resource === undefined) {
    return false;
  }
  const requestUrl = new URL(request.url);
  return (
    requestUrl.origin === resource.origin &&
    requestUrl.pathname === resource.pathname &&
    requestUrl.search === "" &&
    requestUrl.hash === ""
  );
}

/**
 * Trusts the configured OAuth client to obtain the user's confirmation before
 * invoking a write tool. OAuth itself does not attest to a per-call approval.
 */
export class TrustedOAuthClientExplicitActionPolicy
  implements ContinuityMcpExplicitUserActionPolicy
{
  readonly #trustedClientIds: ReadonlySet<string>;

  public constructor(options: TrustedOAuthClientExplicitActionPolicyOptions) {
    if (options.trustedClientIds.length === 0) {
      throw new Error("At least one trusted OAuth client ID is required.");
    }
    const trustedClientIds = options.trustedClientIds.map(validateClientId);
    if (new Set(trustedClientIds).size !== trustedClientIds.length) {
      throw new Error("Trusted OAuth client IDs must be unique.");
    }
    this.#trustedClientIds = new Set(trustedClientIds);
  }

  public authorize(input: ContinuityMcpExplicitUserActionInput): boolean {
    return (
      input.request.method === "POST" &&
      sameResource(input.request, input.authInfo.resource) &&
      input.authInfo.scopes.includes(continuityMcpWriteScope) &&
      this.#trustedClientIds.has(input.authInfo.clientId)
    );
  }
}
