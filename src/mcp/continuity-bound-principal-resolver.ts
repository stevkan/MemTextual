import type { AuthInfo } from "@modelcontextprotocol/server";
import type { ContinuityVerifiedIdentity } from "../domain/continuity-identity.js";
import type { ContinuityIdentityBindingService } from "../services/continuity-identity-binding-service.js";
import type { ContinuityAuthenticatedPrincipal } from "../services/continuity-authenticated-persona-service.js";
import type { ContinuityMcpHttpPrincipalResolver } from "./continuity-http.js";

export interface ContinuityVerifiedIdentityExtractor {
  extract(authInfo: AuthInfo): ContinuityVerifiedIdentity;
}

export class ContinuityBoundMcpPrincipalResolver
  implements ContinuityMcpHttpPrincipalResolver
{
  public constructor(
    private readonly bindings: ContinuityIdentityBindingService,
    private readonly extractor: ContinuityVerifiedIdentityExtractor,
  ) {}

  public resolve(authInfo: AuthInfo): ContinuityAuthenticatedPrincipal {
    return this.bindings.resolve(this.extractor.extract(authInfo));
  }
}
