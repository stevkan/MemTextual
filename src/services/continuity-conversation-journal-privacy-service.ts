import { randomUUID } from "node:crypto";
import type {
  ContinuityConversationJournalPurgePreview,
  ContinuityConversationJournalPurgeReceipt,
  PurgeContinuityConversationJournalInput,
} from "../domain/continuity-conversation.js";
import type { HostAuthorizationMutationContext } from "../domain/host-event.js";
import type { ContinuityConversationJournalPrivacyRepository } from "../repositories/continuity-conversation-journal-privacy-repository.js";

export class ExplicitConversationJournalPurgeRequiredError extends Error {
  public constructor() {
    super("Conversation journal purge requires an explicit user action.");
    this.name = "ExplicitConversationJournalPurgeRequiredError";
  }
}

export class ContinuityConversationJournalPrivacyService {
  readonly #now: () => Date;

  public constructor(
    private readonly repository: ContinuityConversationJournalPrivacyRepository,
    options: { now?: () => Date } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  public preview(
    conversationId: string,
    personaId: string,
  ): ContinuityConversationJournalPurgePreview {
    const impact = this.repository.previewJournalPurge(
      requiredText(conversationId, "conversationId", 500),
      requiredText(personaId, "personaId", 500),
    );
    return {
      conversationId: impact.conversationId,
      hostDeletionConfirmed: impact.hostDeletionConfirmed,
      alreadyPurged: impact.alreadyPurged,
      turnCount: impact.turnCount,
      hostEventCount: impact.hostEventCount,
      sourceSeriesCount: impact.sourceSeriesCount,
      sourceRecordCount: impact.sourceRecordCount,
      candidateCount: impact.candidateCount,
      dependentMemoryIds: impact.dependentMemoryIds,
      activeReviewPolicyIds: impact.activeReviewPolicyIds,
      blockers: impact.blockers,
      canPurge: impact.canPurge,
      confirmation: confirmationFor(impact.conversationId, impact.fingerprint),
      activeDatabaseDeletionIsPermanent: true,
      externalCopiesNotModified: true,
      snapshotsAndBackupsMayRemain: true,
    };
  }

  public purge(
    input: PurgeContinuityConversationJournalInput,
    context: HostAuthorizationMutationContext = {},
  ): ContinuityConversationJournalPurgeReceipt {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitConversationJournalPurgeRequiredError();
    }
    const conversationId = requiredText(
      input.conversationId,
      "conversationId",
      500,
    );
    const personaId = requiredText(input.personaId, "personaId", 500);
    const reason = requiredText(input.reason, "reason", 1000);
    const impact = this.repository.previewJournalPurge(conversationId, personaId);
    if (input.confirmation !== confirmationFor(conversationId, impact.fingerprint)) {
      throw new Error("Confirmation does not match the current journal-purge preview.");
    }
    if (
      !input.acknowledgePermanentActiveDatabaseDeletion ||
      !input.acknowledgeExternalCopiesMayRemain
    ) {
      throw new Error(
        "Journal purge requires acknowledgement of permanent active-database deletion and retained external copies.",
      );
    }
    if (!impact.canPurge) {
      throw new Error(
        `Conversation journal cannot be purged: ${impact.blockers.join(" ")}`,
      );
    }
    return this.repository.purgeJournal({
      conversationId,
      personaId,
      reason,
      expectedFingerprint: impact.fingerprint,
      receiptId: randomUUID(),
      purgedAt: this.#now().toISOString(),
    });
  }
}

function confirmationFor(conversationId: string, fingerprint: string): string {
  return `PURGE LOCAL JOURNAL ${conversationId} ${fingerprint.slice(0, 12)}`;
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}
