import type { ContinuityContextComposition, ContinuityContextQuery } from "./continuity-context.js";
import type {
  CompletedConversationTurn,
  ConversationHostEvent,
  HistoricalCompletedConversationTurn,
} from "./conversation-host.js";
import type { HostEventCaptureResult } from "./host-event.js";

export const continuityConversationTurnEventKind =
  "conversation.turn.completed" as const;

export const continuityConversationCaptureStatuses = [
  "pending",
  "failed",
  "captured",
] as const;

export type ContinuityConversationCaptureStatus =
  (typeof continuityConversationCaptureStatuses)[number];

export const continuityConversationHostDeletionStatuses = [
  "pending",
  "failed",
  "deleted",
] as const;

export type ContinuityConversationHostDeletionStatus =
  (typeof continuityConversationHostDeletionStatuses)[number];

export interface ContinuityConversationHostDeletion {
  conversationId: string;
  status: ContinuityConversationHostDeletionStatus;
  attemptCount: number;
  lastAttemptAt: string;
  failureCode: string | null;
  deletedAt: string | null;
  updatedAt: string;
}

export interface ContinuityConversationHostDeletionPreview {
  conversationId: string;
  hostId: string;
  status: ContinuityConversationHostDeletionStatus | "not_requested";
  turnCount: number;
  unresolvedCaptureCount: number;
  confirmation: string;
  localJournalWillRemain: true;
  derivedMemoriesWillRemain: true;
  snapshotsAndBackupsMayRemain: true;
}

export interface DeleteContinuityConversationHostInput {
  conversationId: string;
  personaId: string;
  confirmation: string;
  acknowledgeLocalDataRemains: boolean;
  acknowledgeBackupsMayRemain: boolean;
}

export interface ContinuityConversationJournalPurgePreview {
  conversationId: string;
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
  confirmation: string;
  activeDatabaseDeletionIsPermanent: true;
  externalCopiesNotModified: true;
  snapshotsAndBackupsMayRemain: true;
}

export interface PurgeContinuityConversationJournalInput {
  conversationId: string;
  personaId: string;
  reason: string;
  confirmation: string;
  acknowledgePermanentActiveDatabaseDeletion: boolean;
  acknowledgeExternalCopiesMayRemain: boolean;
}

export interface ContinuityConversationJournalPurgeReceipt {
  receiptId: string;
  conversationId: string;
  personaId: string;
  purgedAt: string;
  deletedRowCounts: Record<string, number>;
  externalCopiesNotModified: true;
}

export interface ContinuityConversation {
  id: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  authorizationId: string;
  hostId: string;
  externalConversationId: string;
  behaviorProfileId: string | null;
  behaviorProfileRevision: number | null;
  createdAt: string;
}

export interface CreateContinuityConversationRecordInput
  extends Omit<ContinuityConversation, "createdAt"> {}

export interface ContinuityConversationTurnCapture {
  id: string;
  conversationId: string;
  externalTurnId: string;
  externalEventId: string;
  userText: string;
  assistantText: string;
  completedAt: string;
  contextFormatVersion: number;
  memoryRevisionIds: string[];
  status: ContinuityConversationCaptureStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  failureCode: string | null;
  receiptId: string | null;
  capturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityConversationSummary {
  conversation: ContinuityConversation;
  hostDeletion: ContinuityConversationHostDeletion | null;
  journalPurge: ContinuityConversationJournalPurgeReceipt | null;
  turnCount: number;
  unresolvedCaptureCount: number;
  lastActivityAt: string;
}

export interface ContinuityConversationDetail {
  summary: ContinuityConversationSummary;
  turns: ContinuityConversationTurnCapture[];
}

export interface CreateContinuityConversationTurnCaptureInput {
  id: string;
  conversationId: string;
  externalTurnId: string;
  externalEventId: string;
  userText: string;
  assistantText: string;
  completedAt: string;
  contextFormatVersion: number;
  memoryRevisionIds: string[];
}

export interface StartContinuityConversationInput {
  personaId: string;
  authorizationId: string;
  grant: string;
  model?: string;
}

export interface ResumeContinuityConversationInput {
  conversationId: string;
  personaId: string;
  grant: string;
}

export interface SendContinuityConversationTurnInput {
  conversationId: string;
  personaId: string;
  grant: string;
  text: string;
  context?: Omit<ContinuityContextQuery, "personaId" | "text">;
  onEvent?: (event: ConversationHostEvent) => void;
}

export interface RetryContinuityConversationCaptureInput {
  captureId: string;
  personaId: string;
  grant: string;
}

export interface ReconcileContinuityConversationInput {
  conversationId: string;
  personaId: string;
  grant: string;
}

export interface ContinuityConversationTurnPayload {
  conversationId: string;
  externalConversationId: string;
  turnId: string;
  userText: string;
  assistantText: string;
  context: {
    formatVersion: number;
    memoryRevisionIds: string[];
  };
}

export interface ContinuityConversationTurnResult {
  conversation: ContinuityConversation;
  turn: CompletedConversationTurn;
  context: ContinuityContextComposition;
  capture: HostEventCaptureResult;
  captureRecord: ContinuityConversationTurnCapture;
}

export interface ContinuityConversationCaptureRetryResult {
  conversation: ContinuityConversation;
  capture: HostEventCaptureResult;
  captureRecord: ContinuityConversationTurnCapture;
}

export interface RecoveredContinuityConversationTurn {
  turn: HistoricalCompletedConversationTurn;
  capture: HostEventCaptureResult;
  captureRecord: ContinuityConversationTurnCapture;
}

export interface ContinuityConversationReconciliationResult {
  conversation: ContinuityConversation;
  hostTurnCount: number;
  existingCaptureCount: number;
  recovered: RecoveredContinuityConversationTurn[];
}

export interface OpenContinuityConversationResult {
  conversation: ContinuityConversation;
  reconciliation: ContinuityConversationReconciliationResult;
}
