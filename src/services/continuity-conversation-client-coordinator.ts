import type {
  ContinuityConversation,
  ContinuityConversationCaptureRetryResult,
  ContinuityConversationJournaledTurnResult,
  ContinuityConversationReconciliationResult,
  ContinuityConversationTurnCapture,
  OpenContinuityConversationResult,
  ReconcileContinuityConversationInput,
  RetryContinuityConversationCaptureInput,
  ResumeContinuityConversationInput,
  SendContinuityConversationTurnInput,
  StartContinuityConversationInput,
} from "../domain/continuity-conversation.js";

export interface ContinuityConversationClientOperations {
  startConversation(
    input: StartContinuityConversationInput,
  ): Promise<ContinuityConversation>;
  resumeConversation(
    input: ResumeContinuityConversationInput,
  ): Promise<ContinuityConversation>;
  reconcileConversationHistory(
    input: ReconcileContinuityConversationInput,
  ): Promise<ContinuityConversationReconciliationResult>;
  listRecoverableCaptures(personaId: string): ContinuityConversationTurnCapture[];
  journalTurn(
    input: SendContinuityConversationTurnInput,
  ): Promise<ContinuityConversationJournaledTurnResult>;
  retryCapture(
    input: RetryContinuityConversationCaptureInput,
  ): Promise<ContinuityConversationCaptureRetryResult>;
}

interface OpenConversationState {
  personaId: string;
  status: "opening" | "ready" | "sending" | "capturing";
}

export class ContinuityConversationOpenRecoveryRequiredError extends Error {
  public constructor(
    public readonly conversationId: string,
    public readonly captures: ContinuityConversationTurnCapture[],
  ) {
    super(
      `The Continuity conversation has ${captures.length} unresolved capture record(s).`,
    );
    this.name = "ContinuityConversationOpenRecoveryRequiredError";
  }
}

/**
 * In-memory lifecycle gate for a Continuity conversational client. A fresh
 * coordinator starts closed, forcing persisted conversations through history
 * reconciliation before another turn can be submitted.
 */
export class ContinuityConversationClientCoordinator {
  readonly #open = new Map<string, OpenConversationState>();
  readonly #captureTasks = new Set<Promise<void>>();

  public constructor(
    private readonly conversations: ContinuityConversationClientOperations,
  ) {}

  public async startConversation(
    input: StartContinuityConversationInput,
  ): Promise<ContinuityConversation> {
    const conversation = await this.conversations.startConversation(input);
    this.#open.set(conversation.id, {
      personaId: conversation.personaId,
      status: "ready",
    });
    return conversation;
  }

  public async openConversation(
    input: ResumeContinuityConversationInput,
  ): Promise<OpenContinuityConversationResult> {
    const conversationId = requiredText(input.conversationId, "conversationId");
    const personaId = requiredText(input.personaId, "personaId");
    const current = this.#open.get(conversationId);
    if (current !== undefined && current.status !== "ready") {
      throw new Error("The Continuity conversation has an active operation.");
    }
    const opening: OpenConversationState = { personaId, status: "opening" };
    this.#open.set(conversationId, opening);

    try {
      const reconciliation =
        await this.conversations.reconcileConversationHistory({
          conversationId,
          personaId,
          grant: input.grant,
        });
      const recoverableCaptures = this.conversations
        .listRecoverableCaptures(personaId)
        .filter((capture) => capture.conversationId === conversationId);
      if (recoverableCaptures.length > 0) {
        throw new ContinuityConversationOpenRecoveryRequiredError(
          conversationId,
          recoverableCaptures,
        );
      }
      const conversation = await this.conversations.resumeConversation({
        conversationId,
        personaId,
        grant: input.grant,
      });
      if (conversation.id !== reconciliation.conversation.id) {
        throw new Error("Conversation open returned inconsistent bindings.");
      }
      opening.status = "ready";
      return { conversation, reconciliation };
    } catch (error) {
      if (this.#open.get(conversationId) === opening) {
        this.#open.delete(conversationId);
      }
      throw error;
    }
  }

  public async sendTurn(
    input: SendContinuityConversationTurnInput,
  ): Promise<ContinuityConversationJournaledTurnResult> {
    const conversationId = requiredText(input.conversationId, "conversationId");
    const personaId = requiredText(input.personaId, "personaId");
    const current = this.#open.get(conversationId);
    if (
      current === undefined ||
      current.personaId !== personaId ||
      current.status === "opening"
    ) {
      throw new Error(
        "The Continuity conversation must be opened and reconciled before sending.",
      );
    }
    if (current.status !== "ready") {
      throw new Error("The Continuity conversation already has an active turn.");
    }
    current.status = "sending";
    try {
      const result = await this.conversations.journalTurn(input);
      current.status = "capturing";
      const captureTask = this.conversations.retryCapture({
        captureId: result.captureRecord.id,
        personaId,
        grant: input.grant,
      }).then(() => {
        if (this.#open.get(conversationId) === current) {
          current.status = "ready";
        }
      }).catch(() => {
        if (this.#open.get(conversationId) === current) {
          this.#open.delete(conversationId);
        }
      }).then(() => undefined);
      this.#captureTasks.add(captureTask);
      void captureTask.finally(() => this.#captureTasks.delete(captureTask));
      return result;
    } catch (error) {
      this.#open.delete(conversationId);
      throw error;
    }
  }

  public async drain(): Promise<void> {
    await Promise.all([...this.#captureTasks]);
  }

  public async retryCapture(
    input: RetryContinuityConversationCaptureInput,
  ): Promise<ContinuityConversationCaptureRetryResult> {
    const personaId = requiredText(input.personaId, "personaId");
    const captureId = requiredText(input.captureId, "captureId");
    return this.conversations.retryCapture({
      captureId,
      personaId,
      grant: input.grant,
    });
  }

  public leaveConversation(conversationId: string, personaId: string): void {
    const normalizedConversationId = requiredText(conversationId, "conversationId");
    const normalizedPersonaId = requiredText(personaId, "personaId");
    const current = this.#open.get(normalizedConversationId);
    if (current?.personaId === normalizedPersonaId) {
      if (current.status !== "ready") {
        throw new Error("The Continuity conversation has an active operation.");
      }
      this.#open.delete(normalizedConversationId);
    }
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
