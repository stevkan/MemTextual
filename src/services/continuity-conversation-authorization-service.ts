import type {
  ConversationGrantBinding,
  ConversationGrantStore,
} from "../domain/conversation-grant-store.js";
import {
  conversationGrantBindingFromAuthorization,
  conversationGrantBindingFromConversation,
} from "../domain/conversation-grant-store.js";
import type { ContinuityConversation } from "../domain/continuity-conversation.js";
import type {
  AuthorizeHostInput,
  HostAuthorization,
  HostAuthorizationMutationContext,
} from "../domain/host-event.js";
import type { PersonaContext } from "../domain/persona.js";
import type { HostAuthorizationService } from "./host-event-service.js";

export interface RevokeStoredConversationAuthorizationResult {
  authorization: HostAuthorization;
  protectedGrantDeleted: boolean;
}

export interface ResolvedConversationAuthorization {
  authorization: HostAuthorization;
  grant: string;
}

export class ContinuityConversationAuthorizationService {
  public constructor(
    private readonly authorizations: HostAuthorizationService,
    private readonly grants: ConversationGrantStore,
  ) {}

  public async authorize(
    input: AuthorizeHostInput,
    context: HostAuthorizationMutationContext = {},
  ): Promise<HostAuthorization> {
    const issued = this.authorizations.authorize(input, context);
    try {
      await this.grants.store({
        ...conversationGrantBindingFromAuthorization(issued.authorization),
        grant: issued.grant,
      });
      return issued.authorization;
    } catch (storeError) {
      try {
        this.authorizations.revoke(issued.authorization.id, context);
      } catch {
        throw new Error(
          "Protected grant storage failed and the new host authorization could not be revoked automatically.",
          { cause: storeError },
        );
      }
      throw new Error(
        "Protected grant storage failed; the new host authorization was revoked.",
        { cause: storeError },
      );
    }
  }

  public async resolveForAuthorization(
    authorization: HostAuthorization,
  ): Promise<string> {
    return this.requireGrant(
      conversationGrantBindingFromAuthorization(authorization),
    );
  }

  public listForPersona(
    persona: PersonaContext,
    includeRevoked = false,
  ): HostAuthorization[] {
    return this.authorizations
      .list(requiredIdentifier(persona.persona.userId, "userId"), includeRevoked)
      .filter(
        (authorization) =>
          authorization.personaId === persona.persona.id &&
          authorization.relationshipId === persona.relationship.id,
      );
  }

  public async resolveForPersonaAuthorization(
    authorizationId: string,
    persona: PersonaContext,
  ): Promise<ResolvedConversationAuthorization> {
    const normalizedAuthorizationId = requiredIdentifier(
      authorizationId,
      "authorizationId",
    );
    const authorization = this.authorizations
      .list(persona.persona.userId, true)
      .find(({ id }) => id === normalizedAuthorizationId);
    if (
      authorization === undefined ||
      authorization.personaId !== persona.persona.id ||
      authorization.relationshipId !== persona.relationship.id
    ) {
      throw new Error(`Host authorization not found: ${normalizedAuthorizationId}`);
    }
    return {
      authorization,
      grant: await this.requireGrant(
        conversationGrantBindingFromAuthorization(authorization),
      ),
    };
  }

  public async resolveForConversation(
    conversation: ContinuityConversation,
  ): Promise<string> {
    return this.requireGrant(conversationGrantBindingFromConversation(conversation));
  }

  public async revoke(
    binding: ConversationGrantBinding,
    context: HostAuthorizationMutationContext = {},
  ): Promise<RevokeStoredConversationAuthorizationResult> {
    const authorizationId = requiredIdentifier(
      binding.authorizationId,
      "authorizationId",
    );
    const current = this.authorizations
      .list(requiredIdentifier(binding.userId, "userId"), true)
      .find(({ id }) => id === authorizationId);
    if (current === undefined) {
      throw new Error(`Host authorization not found: ${authorizationId}`);
    }
    requireBindingMatchesAuthorization(binding, current);
    const authorization = this.authorizations.revoke(authorizationId, context);
    const protectedGrantDeleted = await this.grants.delete(binding);
    return { authorization, protectedGrantDeleted };
  }

  private async requireGrant(binding: ConversationGrantBinding): Promise<string> {
    const current = this.authorizations
      .list(requiredIdentifier(binding.userId, "userId"), true)
      .find(({ id }) => id === binding.authorizationId);
    if (current === undefined) {
      throw new Error(`Host authorization not found: ${binding.authorizationId}`);
    }
    requireBindingMatchesAuthorization(binding, current);
    if (
      current.status !== "active" ||
      (current.expiresAt !== null && current.expiresAt < new Date().toISOString())
    ) {
      throw new Error("Protected conversation grant authorization is not active.");
    }
    const grant = await this.grants.load(binding);
    if (grant === null) {
      throw new Error(
        `Protected conversation grant unavailable: ${binding.authorizationId}`,
      );
    }
    return grant;
  }
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 500) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function requireBindingMatchesAuthorization(
  binding: ConversationGrantBinding,
  authorization: HostAuthorization,
): void {
  if (
    binding.authorizationId !== authorization.id ||
    binding.userId !== authorization.userId ||
    binding.personaId !== authorization.personaId ||
    binding.relationshipId !== authorization.relationshipId ||
    binding.hostId !== authorization.hostId
  ) {
    throw new Error("The protected grant binding does not match its authorization.");
  }
}
