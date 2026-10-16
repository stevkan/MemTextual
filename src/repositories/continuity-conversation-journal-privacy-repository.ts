import type {
  ContinuityConversationJournalPurgeReceipt,
} from "../domain/continuity-conversation.js";

export interface ConversationJournalPurgeImpact {
  conversationId: string;
  personaId: string;
  hostDeletionConfirmed: boolean;
  alreadyPurged: boolean;
  turnCount: number;
  hostEventCount: number;
  sourceSeriesCount: number;
  sourceRecordCount: number;
  candidateCount: number;
  dependentMemoryIds: string[];
  activeReviewPolicyIds: string[];
  blockers: string[];
  canPurge: boolean;
  fingerprint: string;
}

export interface PurgeConversationJournalRecordInput {
  conversationId: string;
  personaId: string;
  reason: string;
  expectedFingerprint: string;
  receiptId: string;
  purgedAt: string;
}

export interface ContinuityConversationJournalPrivacyRepository {
  previewJournalPurge(
    conversationId: string,
    personaId: string,
  ): ConversationJournalPurgeImpact;
  purgeJournal(
    input: PurgeConversationJournalRecordInput,
  ): ContinuityConversationJournalPurgeReceipt;
  getJournalPurgeReceipt(
    conversationId: string,
  ): ContinuityConversationJournalPurgeReceipt | null;
}
