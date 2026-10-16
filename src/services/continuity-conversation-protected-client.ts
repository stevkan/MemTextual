import type {
  ContinuityConversation,
  ContinuityConversationCaptureRetryResult,
  ContinuityConversationTurnResult,
  OpenContinuityConversationResult,
  SendContinuityConversationTurnInput,
  StartContinuityConversationInput,
} from "../domain/continuity-conversation.js";
import type { HostAuthorization } from "../domain/host-event.js";
import type { PersonaContext } from "../domain/persona.js";

export type StartProtectedContinuityConversationInput = Omit<
  StartContinuityConversationInput,
  "grant"
>;

export interface OpenProtectedContinuityConversationInput {
  conversationId: string;
  personaId: string;
}

export interface RetryProtectedContinuityConversationCaptureInput {
  captureId: string;
  conversationId: string;
  personaId: string;
}

export type SendProtectedContinuityConversationTurnInput = Omit<
  SendContinuityConversationTurnInput,
  "grant"
>;

export interface ContinuityConversationProtectedGrantResolver {
  resolveForPersonaAuthorization(
    authorizationId: string,
    persona: PersonaContext,
  ): Promise<{ authorization: HostAuthorization; grant: string }>;
  resolveForConversation(conversation: ContinuityConversation): Promise<string>;
}

export interface ContinuityConversationProtectedLifecycle {
  startConversation(
    input: StartContinuityConversationInput,
  ): Promise<ContinuityConversation>;
  openConversation(input: {
    conversationId: string;
    personaId: string;
    grant: string;
  }): Promise<OpenContinuityConversationResult>;
  sendTurn(
    input: SendContinuityConversationTurnInput,
  ): Promise<ContinuityConversationTurnResult>;
  retryCapture(input: {
    captureId: string;
    personaId: string;
    grant: string;
  }): Promise<ContinuityConversationCaptureRetryResult>;
  leaveConversation(conversationId: string, personaId: string): void;
}

export interface ContinuityConversationProtectedClientOptions {
  authorizations: ContinuityConversationProtectedGrantResolver;
  conversations: {
    getConversation(id: string): ContinuityConversation | null;
  };
  lifecycle: ContinuityConversationProtectedLifecycle;
  personas: {
    getPersonaContext(id: string): PersonaContext | null;
  };
}

export class ContinuityConversationProtectedClient {
  readonly #authorizations: ContinuityConversationProtectedGrantResolver;
  readonly #conversations: ContinuityConversationProtectedClientOptions["conversations"];
  readonly #lifecycle: ContinuityConversationProtectedLifecycle;
  readonly #personas: ContinuityConversationProtectedClientOptions["personas"];

  public constructor(options: ContinuityConversationProtectedClientOptions) {
    this.#authorizations = options.authorizations;
    this.#conversations = options.conversations;
    this.#lifecycle = options.lifecycle;
    this.#personas = options.personas;
  }

  public async startConversation(
    input: StartProtectedContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    const persona = this.requirePersona(input.personaId);
    const authorizationId = requiredText(input.authorizationId, "authorizationId");
    const resolved = await this.#authorizations.resolveForPersonaAuthorization(
      authorizationId,
      persona,
    );
    requireResolvedAuthorization(resolved, authorizationId, persona);
    const conversation = await this.#lifecycle.startConversation({
      personaId: persona.persona.id,
      authorizationId: resolved.authorization.id,
      grant: resolved.grant,
      ...(input.model === undefined ? {} : { model: input.model }),
    });
    requireConversationMatchesAuthorization(
      conversation,
      resolved.authorization,
    );
    return conversation;
  }

  public async openConversation(
    input: OpenProtectedContinuityConversationInput,
  ): Promise<OpenContinuityConversationResult> {
    const conversation = this.requireConversation(
      input.conversationId,
      input.personaId,
    );
    const grant = requireGrant(
      await this.#authorizations.resolveForConversation(conversation),
    );
    const result = await this.#lifecycle.openConversation({
      conversationId: conversation.id,
      personaId: conversation.personaId,
      grant,
    });
    requireSameConversationBinding(result.conversation, conversation, "open");
    return result;
  }

  public async sendTurn(
    input: SendProtectedContinuityConversationTurnInput,
  ): Promise<ContinuityConversationTurnResult> {
    const conversation = this.requireConversation(
      input.conversationId,
      input.personaId,
    );
    const grant = requireGrant(
      await this.#authorizations.resolveForConversation(conversation),
    );
    const result = await this.#lifecycle.sendTurn({
      conversationId: conversation.id,
      personaId: conversation.personaId,
      grant,
      text: input.text,
      ...(input.context === undefined ? {} : { context: input.context }),
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    });
    requireSameConversationBinding(result.conversation, conversation, "turn");
    return result;
  }

  public async retryCapture(
    input: RetryProtectedContinuityConversationCaptureInput,
  ): Promise<ContinuityConversationCaptureRetryResult> {
    const conversation = this.requireConversation(
      input.conversationId,
      input.personaId,
    );
    const grant = requireGrant(
      await this.#authorizations.resolveForConversation(conversation),
    );
    const result = await this.#lifecycle.retryCapture({
      captureId: requiredText(input.captureId, "captureId"),
      personaId: conversation.personaId,
      grant,
    });
    requireSameConversationBinding(result.conversation, conversation, "retry");
    return result;
  }

  public leaveConversation(conversationId: string, personaId: string): void {
    const conversation = this.requireConversation(conversationId, personaId);
    this.#lifecycle.leaveConversation(conversation.id, conversation.personaId);
  }

  private requirePersona(personaId: string): PersonaContext {
    const normalizedPersonaId = requiredText(personaId, "personaId");
    const persona = this.#personas.getPersonaContext(normalizedPersonaId);
    if (persona === null) {
      throw new Error(`Persona not found: ${normalizedPersonaId}`);
    }
    return persona;
  }

  private requireConversation(
    conversationId: string,
    personaId: string,
  ): ContinuityConversation {
    const normalizedConversationId = requiredText(conversationId, "conversationId");
    const normalizedPersonaId = requiredText(personaId, "personaId");
    const conversation = this.#conversations.getConversation(
      normalizedConversationId,
    );
    if (conversation === null || conversation.personaId !== normalizedPersonaId) {
      throw new Error(`Continuity conversation not found: ${normalizedConversationId}`);
    }
    return conversation;
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 500) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function requireConversationMatchesAuthorization(
  conversation: ContinuityConversation,
  authorization: HostAuthorization,
): void {
  if (
    conversation.authorizationId !== authorization.id ||
    conversation.userId !== authorization.userId ||
    conversation.personaId !== authorization.personaId ||
    conversation.relationshipId !== authorization.relationshipId ||
    conversation.hostId !== authorization.hostId
  ) {
    throw new Error(
      "Conversation lifecycle returned a conversation outside its authorization binding.",
    );
  }
}

function requireSameConversationBinding(
  actual: ContinuityConversation,
  expected: ContinuityConversation,
  operation: "open" | "retry" | "turn",
): void {
  if (
    actual.id !== expected.id ||
    actual.authorizationId !== expected.authorizationId ||
    actual.userId !== expected.userId ||
    actual.personaId !== expected.personaId ||
    actual.relationshipId !== expected.relationshipId ||
    actual.hostId !== expected.hostId ||
    actual.externalConversationId !== expected.externalConversationId
  ) {
    throw new Error(
      `Conversation ${operation} returned an unexpected conversation binding.`,
    );
  }
}

function requireResolvedAuthorization(
  resolved: { authorization: HostAuthorization; grant: string },
  authorizationId: string,
  persona: PersonaContext,
): void {
  if (
    resolved.authorization.id !== authorizationId ||
    resolved.authorization.userId !== persona.persona.userId ||
    resolved.authorization.personaId !== persona.persona.id ||
    resolved.authorization.relationshipId !== persona.relationship.id ||
    resolved.authorization.status !== "active" ||
    (resolved.authorization.expiresAt !== null &&
      resolved.authorization.expiresAt < new Date().toISOString())
  ) {
    throw new Error("Protected conversation authorization crossed its binding.");
  }
  requireGrant(resolved.grant);
}

function requireGrant(grant: string): string {
  if (!/^mthg_[A-Za-z0-9_-]{43}$/u.test(grant)) {
    throw new Error("Protected conversation grant is invalid.");
  }
  return grant;
}
