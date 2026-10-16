import { createHash } from "node:crypto";
import type {
  ContinuityConversationHostDeletion,
  ContinuityConversationHostDeletionPreview,
  DeleteContinuityConversationHostInput,
} from "../domain/continuity-conversation.js";
import type { DeletableConversationHost } from "../domain/conversation-host.js";
import type { HostAuthorizationMutationContext } from "../domain/host-event.js";
import type { ContinuityConversationRepository } from "../repositories/continuity-conversation-repository.js";

export class ExplicitConversationHostDeletionRequiredError extends Error {
  public constructor() {
    super("Host-thread deletion requires an explicit user action.");
    this.name = "ExplicitConversationHostDeletionRequiredError";
  }
}

export class ConversationHostDeletionFinalizationError extends Error {
  public readonly providerConfirmed = true;

  public constructor(
    public readonly conversationId: string,
    options?: ErrorOptions,
  ) {
    super(
      "The host confirmed deletion, but MemTextual could not finalize its local deletion record.",
      options,
    );
    this.name = "ConversationHostDeletionFinalizationError";
  }
}

export interface ContinuityConversationHostDeletionServiceOptions {
  leaveConversation(conversationId: string, personaId: string): void;
  now?: () => Date;
}

export class ContinuityConversationHostDeletionService {
  readonly #now: () => Date;

  public constructor(
    private readonly repository: ContinuityConversationRepository,
    private readonly host: DeletableConversationHost,
    private readonly options: ContinuityConversationHostDeletionServiceOptions,
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  public preview(
    conversationId: string,
    personaId: string,
  ): ContinuityConversationHostDeletionPreview {
    const normalizedConversationId = requiredText(conversationId, "conversationId");
    const normalizedPersonaId = requiredText(personaId, "personaId");
    const summary = this.repository
      .listConversations(normalizedPersonaId)
      .find(({ conversation }) => conversation.id === normalizedConversationId);
    if (summary === undefined) {
      throw new Error(`Continuity conversation not found: ${normalizedConversationId}`);
    }
    const basis = {
      conversationId: summary.conversation.id,
      hostId: summary.conversation.hostId,
      status: summary.hostDeletion?.status ?? "not_requested",
      turnCount: summary.turnCount,
      unresolvedCaptureCount: summary.unresolvedCaptureCount,
    } as const;
    const digest = createHash("sha256")
      .update(JSON.stringify(basis), "utf8")
      .digest("hex")
      .slice(0, 12);
    return {
      ...basis,
      confirmation: `DELETE HOST THREAD ${basis.conversationId} ${digest}`,
      localJournalWillRemain: true,
      derivedMemoriesWillRemain: true,
      snapshotsAndBackupsMayRemain: true,
    };
  }

  public async deleteHostConversation(
    input: DeleteContinuityConversationHostInput,
    context: HostAuthorizationMutationContext = {},
  ): Promise<ContinuityConversationHostDeletion> {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitConversationHostDeletionRequiredError();
    }
    const preview = this.preview(input.conversationId, input.personaId);
    if (input.confirmation !== preview.confirmation) {
      throw new Error("Confirmation does not match the current host-deletion preview.");
    }
    if (!input.acknowledgeLocalDataRemains || !input.acknowledgeBackupsMayRemain) {
      throw new Error(
        "Host-thread deletion requires acknowledgement that local data and backups may remain.",
      );
    }
    if (preview.status === "deleted") {
      return this.requireDeletion(preview.conversationId);
    }

    this.options.leaveConversation(preview.conversationId, input.personaId);
    const conversation = this.repository.getConversation(preview.conversationId);
    if (
      conversation === null ||
      conversation.personaId !== requiredText(input.personaId, "personaId")
    ) {
      throw new Error(`Continuity conversation not found: ${preview.conversationId}`);
    }
    const attemptedAt = this.#now().toISOString();
    this.repository.beginHostDeletion(preview.conversationId, attemptedAt);
    try {
      const receipt = await this.host.deleteConversation(
        conversation.externalConversationId,
      );
      if (
        receipt.deleted !== true ||
        receipt.conversationId !== conversation.externalConversationId
      ) {
        throw new Error("The conversation host returned an invalid deletion receipt.");
      }
    } catch (error) {
      this.repository.markHostDeletionFailed(
        preview.conversationId,
        attemptedAt,
        "host_delete_failed",
      );
      throw error;
    }

    try {
      return this.repository.markHostDeleted(preview.conversationId, attemptedAt);
    } catch (error) {
      throw new ConversationHostDeletionFinalizationError(
        preview.conversationId,
        { cause: error },
      );
    }
  }

  private requireDeletion(
    conversationId: string,
  ): ContinuityConversationHostDeletion {
    const deletion = this.repository.getHostDeletion(conversationId);
    if (deletion === null) {
      throw new Error(`Conversation host deletion not found: ${conversationId}`);
    }
    return deletion;
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 500) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}
