import { createHash, randomUUID } from "node:crypto";
import type {
  ContinuityContextComposition,
  ContinuityContextQuery,
} from "../domain/continuity-context.js";
import type { ConversationHost } from "../domain/conversation-host.js";
import {
  continuityConversationTurnEventKind,
  type ContinuityConversation,
  type ContinuityConversationTurnPayload,
  type ContinuityConversationTurnResult,
  type ResumeContinuityConversationInput,
  type SendContinuityConversationTurnInput,
  type StartContinuityConversationInput,
} from "../domain/continuity-conversation.js";
import type { ContinuityConversationRepository } from "../repositories/continuity-conversation-repository.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import type { AuthorizedHostEventCaptureService } from "./host-event-service.js";

export interface ContinuityConversationContextProvider {
  compose(query: ContinuityContextQuery): Promise<ContinuityContextComposition>;
}

export interface ContinuityConversationServiceOptions {
  now?: () => Date;
}

export class ContinuityConversationCaptureError extends Error {
  public constructor(
    message: string,
    public readonly conversation: ContinuityConversation,
    public readonly turn: ContinuityConversationTurnResult["turn"],
    public readonly context: ContinuityContextComposition,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContinuityConversationCaptureError";
  }
}

export class ContinuityConversationService {
  readonly #now: () => Date;

  public constructor(
    private readonly repository: ContinuityConversationRepository,
    private readonly personas: PersonaRepository,
    private readonly contexts: ContinuityConversationContextProvider,
    private readonly host: ConversationHost,
    private readonly capture: AuthorizedHostEventCaptureService<ContinuityConversationTurnPayload>,
    options: ContinuityConversationServiceOptions = {},
  ) {
    if (
      host.identity.adapterId !== capture.identity.adapterId ||
      host.identity.adapterVersion !== capture.identity.adapterVersion
    ) {
      throw new Error("The conversation host and capture adapter identities must match.");
    }
    this.#now = options.now ?? (() => new Date());
  }

  public async startConversation(
    input: StartContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    const personaId = requiredText(input.personaId, "personaId");
    const authorizationId = requiredText(input.authorizationId, "authorizationId");
    const persona = this.requirePersona(personaId);
    const authorization = this.capture.assertAuthorized({
      authorizationId,
      grant: input.grant,
      personaId,
      eventKind: continuityConversationTurnEventKind,
    });
    if (
      authorization.userId !== persona.persona.userId ||
      authorization.relationshipId !== persona.relationship.id
    ) {
      throw new Error("The conversation authorization does not match its persona.");
    }
    const session = await this.host.startConversation(
      input.model === undefined ? {} : { model: input.model },
    );
    return this.repository.createConversation({
      id: randomUUID(),
      userId: persona.persona.userId,
      personaId,
      relationshipId: persona.relationship.id,
      authorizationId,
      hostId: this.host.identity.adapterId,
      externalConversationId: session.id,
    });
  }

  public async resumeConversation(
    input: ResumeContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    const conversation = this.requireConversation(input.conversationId, input.personaId);
    this.assertConversationAuthorized(conversation, input.grant);
    const session = await this.host.resumeConversation(conversation.externalConversationId);
    if (session.id !== conversation.externalConversationId) {
      throw new Error("The conversation host resumed an unexpected conversation.");
    }
    return conversation;
  }

  public async sendTurn(
    input: SendContinuityConversationTurnInput,
  ): Promise<ContinuityConversationTurnResult> {
    const text = requiredText(input.text, "text");
    const conversation = this.requireConversation(input.conversationId, input.personaId);
    this.assertConversationAuthorized(conversation, input.grant);
    const context = await this.contexts.compose({
      ...(input.context ?? {}),
      personaId: conversation.personaId,
      text,
    });
    validateContext(context, conversation.personaId);
    await this.host.resumeConversation(conversation.externalConversationId);
    const turn = await this.host.sendTurn({
      conversationId: conversation.externalConversationId,
      text,
      memoryContext: {
        contentRole: "memory_data",
        contextJson: context.contextJson,
      },
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    });

    try {
      const captured = await this.capture.capture({
        authorizationId: conversation.authorizationId,
        grant: input.grant,
        personaId: conversation.personaId,
        event: {
          id: eventId(conversation, turn.turnId),
          kind: continuityConversationTurnEventKind,
          occurredAt: this.#now().toISOString(),
          payload: {
            conversationId: conversation.id,
            externalConversationId: conversation.externalConversationId,
            turnId: turn.turnId,
            userText: turn.userText,
            assistantText: turn.assistantText,
            context: {
              formatVersion: context.payload.formatVersion,
              memoryRevisionIds: context.payload.items.map(({ revisionId }) => revisionId),
            },
          },
        },
      });
      return { conversation, turn, context, capture: captured };
    } catch (error) {
      throw new ContinuityConversationCaptureError(
        "The host turn completed, but ambient capture failed.",
        conversation,
        turn,
        context,
        { cause: error },
      );
    }
  }

  private requirePersona(personaId: string) {
    const persona = this.personas.getPersonaContext(personaId);
    if (persona === null) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    return persona;
  }

  private requireConversation(
    conversationId: string,
    personaId: string,
  ): ContinuityConversation {
    const normalizedConversationId = requiredText(conversationId, "conversationId");
    const normalizedPersonaId = requiredText(personaId, "personaId");
    const conversation = this.repository.getConversation(normalizedConversationId);
    if (conversation === null || conversation.personaId !== normalizedPersonaId) {
      throw new Error(`Continuity conversation not found: ${normalizedConversationId}`);
    }
    if (conversation.hostId !== this.host.identity.adapterId) {
      throw new Error("The Continuity conversation belongs to another host.");
    }
    return conversation;
  }

  private assertConversationAuthorized(
    conversation: ContinuityConversation,
    grant: string,
  ): void {
    const authorization = this.capture.assertAuthorized({
      authorizationId: conversation.authorizationId,
      grant,
      personaId: conversation.personaId,
      eventKind: continuityConversationTurnEventKind,
    });
    if (
      authorization.userId !== conversation.userId ||
      authorization.relationshipId !== conversation.relationshipId
    ) {
      throw new Error("The conversation authorization no longer matches its binding.");
    }
  }
}

function validateContext(
  context: ContinuityContextComposition,
  personaId: string,
): void {
  if (
    context.payload.personaId !== personaId ||
    context.payload.contentRole !== "memory_data"
  ) {
    throw new Error("Conversation context crossed its persona or content-role boundary.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(context.contextJson);
  } catch (error) {
    throw new Error("Conversation context JSON is invalid.", { cause: error });
  }
  if (JSON.stringify(parsed) !== JSON.stringify(context.payload)) {
    throw new Error("Conversation context JSON does not match its payload.");
  }
  if (Buffer.byteLength(context.contextJson, "utf8") !== context.utf8Bytes) {
    throw new Error("Conversation context byte accounting is invalid.");
  }
}

function eventId(conversation: ContinuityConversation, turnId: string): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        hostId: conversation.hostId,
        externalConversationId: conversation.externalConversationId,
        turnId,
      }),
      "utf8",
    )
    .digest("hex");
  return `conversation-turn:${digest}`;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
