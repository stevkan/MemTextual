import { createHash, randomUUID } from "node:crypto";
import type {
  ContinuityIdentityBinding,
  ContinuityIdentityBindingMutationContext,
  ContinuityVerifiedIdentity,
} from "../domain/continuity-identity.js";
import type { ContinuityIdentityBindingRepository } from "../repositories/continuity-identity-binding-repository.js";
import type { ContinuityAuthenticatedPrincipal } from "./continuity-authenticated-persona-service.js";
import type { PersonaService } from "./persona-service.js";

export class ExplicitContinuityIdentityBindingActionRequiredError extends Error {
  public constructor() {
    super("Continuity identity binding changes require an explicit user action.");
    this.name = "ExplicitContinuityIdentityBindingActionRequiredError";
  }
}

export interface ContinuityIdentityBindingPreview {
  confirmation: string;
  identityHash: string;
  issuer: string;
  userId: string;
  alreadyBound: boolean;
}

function requireExplicitUserAction(
  context: ContinuityIdentityBindingMutationContext,
): void {
  if (context.actor !== "user" || context.explicitUserAction !== true) {
    throw new ExplicitContinuityIdentityBindingActionRequiredError();
  }
}

function validatedIdentity(
  identity: ContinuityVerifiedIdentity,
): ContinuityVerifiedIdentity {
  if (
    identity.issuer !== identity.issuer.trim() ||
    identity.issuer.length === 0 ||
    identity.issuer.length > 2048
  ) {
    throw new Error("The verified identity issuer is invalid.");
  }
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(identity.issuer);
  } catch {
    throw new Error("The verified identity issuer is invalid.");
  }
  if (
    issuerUrl.protocol !== "https:" ||
    issuerUrl.username !== "" ||
    issuerUrl.password !== "" ||
    issuerUrl.search !== "" ||
    issuerUrl.hash !== ""
  ) {
    throw new Error("The verified identity issuer must be an HTTPS issuer URL.");
  }
  if (
    identity.subject !== identity.subject.trim() ||
    identity.subject.length === 0 ||
    identity.subject.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(identity.subject)
  ) {
    throw new Error("The verified identity subject is invalid.");
  }
  return identity;
}

export function continuityIdentityHash(
  identity: ContinuityVerifiedIdentity,
): string {
  const valid = validatedIdentity(identity);
  return createHash("sha256")
    .update(valid.issuer, "utf8")
    .update("\0", "utf8")
    .update(valid.subject, "utf8")
    .digest("hex");
}

export class ContinuityIdentityBindingService {
  public constructor(
    private readonly repository: ContinuityIdentityBindingRepository,
    private readonly personas: PersonaService,
  ) {}

  public preview(
    identity: ContinuityVerifiedIdentity,
    userId: string,
  ): ContinuityIdentityBindingPreview {
    const user = this.personas.getUser(userId);
    if (user === null) {
      throw new Error(`Continuity user not found: ${userId}`);
    }
    const valid = validatedIdentity(identity);
    const identityHash = continuityIdentityHash(valid);
    const existing = this.repository.getBindingByIdentityHash(identityHash);
    if (
      existing !== null &&
      (existing.status !== "active" || existing.userId !== user.id)
    ) {
      throw new Error(
        "The verified identity is already bound and cannot be reassigned.",
      );
    }
    const basis = {
      identityHash,
      issuer: valid.issuer,
      userId: user.id,
      existingBindingId: existing?.id ?? null,
    };
    const digest = createHash("sha256")
      .update(JSON.stringify(basis), "utf8")
      .digest("hex")
      .slice(0, 20)
      .toUpperCase();
    return {
      confirmation: `BIND-CONTINUITY-IDENTITY-${digest}`,
      identityHash,
      issuer: valid.issuer,
      userId: user.id,
      alreadyBound: existing !== null,
    };
  }

  public bindConfirmed(
    identity: ContinuityVerifiedIdentity,
    userId: string,
    confirmation: string,
    context: ContinuityIdentityBindingMutationContext = {},
  ): ContinuityIdentityBinding {
    requireExplicitUserAction(context);
    const preview = this.preview(identity, userId);
    if (confirmation !== preview.confirmation) {
      throw new Error(
        "Confirmation does not match the current identity-binding preview.",
      );
    }
    return this.bind(identity, userId, context);
  }

  public bind(
    identity: ContinuityVerifiedIdentity,
    userId: string,
    context: ContinuityIdentityBindingMutationContext = {},
  ): ContinuityIdentityBinding {
    requireExplicitUserAction(context);
    const user = this.personas.getUser(userId);
    if (user === null) {
      throw new Error(`Continuity user not found: ${userId}`);
    }
    const identityHash = continuityIdentityHash(identity);
    const existing = this.repository.getBindingByIdentityHash(identityHash);
    if (existing !== null) {
      if (existing.status === "active" && existing.userId === user.id) {
        return existing;
      }
      throw new Error(
        "The verified identity is already bound and cannot be reassigned.",
      );
    }
    return this.repository.createBinding({
      id: randomUUID(),
      identityHash,
      issuer: identity.issuer,
      userId: user.id,
    });
  }

  public resolve(
    identity: ContinuityVerifiedIdentity,
  ): ContinuityAuthenticatedPrincipal {
    const identityHash = continuityIdentityHash(identity);
    const binding = this.repository.getBindingByIdentityHash(identityHash);
    if (binding === null || binding.status !== "active") {
      throw new Error("The verified identity is not bound to an active Continuity user.");
    }
    if (this.personas.getUser(binding.userId) === null) {
      throw new Error("The bound Continuity user was not found.");
    }
    return {
      authenticationSubject: identityHash,
      continuityUserId: binding.userId,
    };
  }

  public list(userId: string, includeRevoked = false): ContinuityIdentityBinding[] {
    if (this.personas.getUser(userId) === null) {
      throw new Error(`Continuity user not found: ${userId}`);
    }
    return this.repository.listBindings(userId, includeRevoked);
  }

  public revoke(
    identity: ContinuityVerifiedIdentity,
    context: ContinuityIdentityBindingMutationContext = {},
  ): ContinuityIdentityBinding {
    requireExplicitUserAction(context);
    const binding = this.repository.getBindingByIdentityHash(
      continuityIdentityHash(identity),
    );
    if (binding === null || binding.status !== "active") {
      throw new Error("Active Continuity identity binding not found.");
    }
    return this.repository.revokeBinding(binding.id);
  }
}
