import { createHash, randomUUID } from "node:crypto";
import type {
  ContinuityContextComposition,
  ContinuityContextQuery,
} from "../domain/continuity-context.js";
import type {
  ConversationHost,
  HistoricalCompletedConversationTurn,
} from "../domain/conversation-host.js";
import {
  continuityConversationTurnEventKind,
  type ContinuityConversation,
  type ContinuityConversationCaptureRetryResult,
  type ContinuityConversationReconciliationResult,
  type ContinuityConversationTurnCapture,
  type ContinuityConversationTurnPayload,
  type ContinuityConversationTurnResult,
  type ReconcileContinuityConversationInput,
  type ResumeContinuityConversationInput,
  type RetryContinuityConversationCaptureInput,
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
    public readonly captureRecord: ContinuityConversationTurnCapture,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContinuityConversationCaptureError";
  }
}

export class ContinuityConversationReconciliationCaptureError extends Error {
  public constructor(
    message: string,
    public readonly conversation: ContinuityConversation,
    public readonly turn: HistoricalCompletedConversationTurn,
    public readonly captureRecord: ContinuityConversationTurnCapture,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContinuityConversationReconciliationCaptureError";
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

    const completedAt = this.#now().toISOString();
    const captureRecord = this.repository.createTurnCapture({
      id: randomUUID(),
      conversationId: conversation.id,
      externalTurnId: turn.turnId,
      externalEventId: eventId(conversation, turn.turnId),
      userText: turn.userText,
      assistantText: turn.assistantText,
      completedAt,
      contextFormatVersion: context.payload.formatVersion,
      memoryRevisionIds: context.payload.items.map(({ revisionId }) => revisionId),
    });

    try {
      const captured = await this.captureTurn(conversation, captureRecord, input.grant);
      const stored = this.repository.markTurnCaptureCaptured(
        captureRecord.id,
        this.#now().toISOString(),
        captured.receipt.id,
      );
      return { conversation, turn, context, capture: captured, captureRecord: stored };
    } catch (error) {
      const failed = this.markCaptureFailed(captureRecord);
      throw new ContinuityConversationCaptureError(
        "The host turn completed, but ambient capture failed.",
        conversation,
        turn,
        context,
        failed,
        { cause: error },
      );
    }
  }

  public listRecoverableCaptures(
    personaId: string,
  ): ContinuityConversationTurnCapture[] {
    const normalizedPersonaId = requiredText(personaId, "personaId");
    this.requirePersona(normalizedPersonaId);
    return this.repository.listRecoverableTurnCaptures(normalizedPersonaId);
  }

  public async retryCapture(
    input: RetryContinuityConversationCaptureInput,
  ): Promise<ContinuityConversationCaptureRetryResult> {
    const captureId = requiredText(input.captureId, "captureId");
    const personaId = requiredText(input.personaId, "personaId");
    const captureRecord = this.repository.getTurnCapture(captureId);
    if (captureRecord === null) {
      throw new Error(`Conversation capture not found: ${captureId}`);
    }
    const conversation = this.repository.getConversation(captureRecord.conversationId);
    if (
      conversation === null ||
      conversation.personaId !== personaId ||
      conversation.hostId !== this.host.identity.adapterId
    ) {
      throw new Error(`Conversation capture not found: ${captureId}`);
    }
    this.assertConversationAuthorized(conversation, input.grant);
    try {
      const captured = await this.captureTurn(conversation, captureRecord, input.grant);
      const stored = this.repository.markTurnCaptureCaptured(
        captureRecord.id,
        this.#now().toISOString(),
        captured.receipt.id,
      );
      return { conversation, capture: captured, captureRecord: stored };
    } catch (error) {
      const failed = this.markCaptureFailed(captureRecord);
      throw new Error(
        `Conversation capture retry failed and remains recoverable: ${failed.id}`,
        { cause: error },
      );
    }
  }

  public async reconcileConversationHistory(
    input: ReconcileContinuityConversationInput,
  ): Promise<ContinuityConversationReconciliationResult> {
    const conversation = this.requireConversation(
      input.conversationId,
      input.personaId,
    );
    this.assertConversationAuthorized(conversation, input.grant);
    const hostTurns = await this.host.listCompletedTurns(
      conversation.externalConversationId,
    );
    const seenTurnIds = new Set<string>();
    const pendingRecovery: HistoricalCompletedConversationTurn[] = [];
    let existingCaptureCount = 0;

    for (const turn of hostTurns) {
      validateHistoricalTurn(turn, conversation);
      if (seenTurnIds.has(turn.turnId)) {
        throw new Error("Conversation history repeated a completed turn.");
      }
      seenTurnIds.add(turn.turnId);
      const existing = this.repository.getTurnCaptureByTurn(
        conversation.id,
        turn.turnId,
      );
      if (existing === null) {
        pendingRecovery.push(turn);
      } else {
        requireMatchingHistoricalCapture(existing, turn, conversation);
        existingCaptureCount += 1;
      }
    }

    const recovered: ContinuityConversationReconciliationResult["recovered"] = [];
    for (const turn of pendingRecovery) {
      const captureRecord = this.repository.createTurnCapture({
        id: randomUUID(),
        conversationId: conversation.id,
        externalTurnId: turn.turnId,
        externalEventId: eventId(conversation, turn.turnId),
        userText: turn.userText,
        assistantText: turn.assistantText,
        completedAt: turn.completedAt,
        contextFormatVersion: turn.memoryContext.formatVersion,
        memoryRevisionIds: turn.memoryContext.memoryRevisionIds,
      });
      try {
        const captured = await this.captureTurn(
          conversation,
          captureRecord,
          input.grant,
        );
        const stored = this.repository.markTurnCaptureCaptured(
          captureRecord.id,
          this.#now().toISOString(),
          captured.receipt.id,
        );
        recovered.push({ turn, capture: captured, captureRecord: stored });
      } catch (error) {
        const failed = this.markCaptureFailed(captureRecord);
        throw new ContinuityConversationReconciliationCaptureError(
          "A historical host turn was journaled, but ambient capture failed.",
          conversation,
          turn,
          failed,
          { cause: error },
        );
      }
    }

    return {
      conversation,
      hostTurnCount: hostTurns.length,
      existingCaptureCount,
      recovered,
    };
  }

  private async captureTurn(
    conversation: ContinuityConversation,
    record: ContinuityConversationTurnCapture,
    grant: string,
  ) {
    return this.capture.capture({
      authorizationId: conversation.authorizationId,
      grant,
      personaId: conversation.personaId,
      event: {
        id: record.externalEventId,
        kind: continuityConversationTurnEventKind,
        occurredAt: record.completedAt,
        payload: {
          conversationId: conversation.id,
          externalConversationId: conversation.externalConversationId,
          turnId: record.externalTurnId,
          userText: record.userText,
          assistantText: record.assistantText,
          context: {
            formatVersion: record.contextFormatVersion,
            memoryRevisionIds: record.memoryRevisionIds,
          },
        },
      },
    });
  }

  private markCaptureFailed(
    record: ContinuityConversationTurnCapture,
  ): ContinuityConversationTurnCapture {
    if (record.status === "captured") {
      return record;
    }
    return this.repository.markTurnCaptureFailed(
      record.id,
      this.#now().toISOString(),
      "ambient_capture_failed",
    );
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

function validateHistoricalTurn(
  turn: HistoricalCompletedConversationTurn,
  conversation: ContinuityConversation,
): void {
  if (
    turn.conversationId !== conversation.externalConversationId ||
    turn.status !== "completed" ||
    turn.memoryContext.personaId !== conversation.personaId
  ) {
    throw new Error(
      "Conversation history crossed its conversation, completion, or persona boundary.",
    );
  }
  requiredText(turn.turnId, "historical turnId");
  requiredText(turn.userText, "historical userText");
  if (typeof turn.assistantText !== "string") {
    throw new Error("historical assistantText must be a string.");
  }
  if (
    !Number.isSafeInteger(turn.memoryContext.formatVersion) ||
    turn.memoryContext.formatVersion < 1
  ) {
    throw new Error("Historical memory context format is invalid.");
  }
  if (
    !Array.isArray(turn.memoryContext.memoryRevisionIds) ||
    turn.memoryContext.memoryRevisionIds.some(
      (revisionId) =>
        typeof revisionId !== "string" || revisionId.trim().length === 0,
    ) ||
    new Set(turn.memoryContext.memoryRevisionIds).size !==
      turn.memoryContext.memoryRevisionIds.length
  ) {
    throw new Error("Historical memory revision identifiers are invalid.");
  }
  const parsedCompletedAt = new Date(turn.completedAt);
  if (
    Number.isNaN(parsedCompletedAt.getTime()) ||
    parsedCompletedAt.toISOString() !== turn.completedAt
  ) {
    throw new Error("Historical completion timestamp is invalid.");
  }
}

function requireMatchingHistoricalCapture(
  capture: ContinuityConversationTurnCapture,
  turn: HistoricalCompletedConversationTurn,
  conversation: ContinuityConversation,
): void {
  if (
    capture.externalEventId !== eventId(conversation, turn.turnId) ||
    capture.userText !== turn.userText ||
    capture.assistantText !== turn.assistantText ||
    capture.contextFormatVersion !== turn.memoryContext.formatVersion ||
    JSON.stringify(capture.memoryRevisionIds) !==
      JSON.stringify(turn.memoryContext.memoryRevisionIds)
  ) {
    throw new Error(
      `Stored capture does not match host history for turn: ${turn.turnId}`,
    );
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
