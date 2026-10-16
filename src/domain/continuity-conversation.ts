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

export interface ContinuityConversation {
  id: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  authorizationId: string;
  hostId: string;
  externalConversationId: string;
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
  /** Explicit user-controlled behavior for this persona; never inferred from memory. */
  personaBehaviorInstructions?: string;
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
