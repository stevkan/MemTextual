import type { ContinuityContextComposition, ContinuityContextQuery } from "./continuity-context.js";
import type { CompletedConversationTurn, ConversationHostEvent } from "./conversation-host.js";
import type { HostEventCaptureResult } from "./host-event.js";

export const continuityConversationTurnEventKind =
  "conversation.turn.completed" as const;

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
}
