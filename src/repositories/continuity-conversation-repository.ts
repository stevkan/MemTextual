import type {
  ContinuityConversation,
  ContinuityConversationTurnCapture,
  CreateContinuityConversationRecordInput,
  CreateContinuityConversationTurnCaptureInput,
} from "../domain/continuity-conversation.js";

export interface ContinuityConversationRepository {
  createConversation(
    input: CreateContinuityConversationRecordInput,
  ): ContinuityConversation;
  getConversation(id: string): ContinuityConversation | null;
  createTurnCapture(
    input: CreateContinuityConversationTurnCaptureInput,
  ): ContinuityConversationTurnCapture;
  getTurnCapture(id: string): ContinuityConversationTurnCapture | null;
  getTurnCaptureByTurn(
    conversationId: string,
    externalTurnId: string,
  ): ContinuityConversationTurnCapture | null;
  listRecoverableTurnCaptures(
    personaId: string,
  ): ContinuityConversationTurnCapture[];
  markTurnCaptureFailed(
    id: string,
    attemptedAt: string,
    failureCode: string,
  ): ContinuityConversationTurnCapture;
  markTurnCaptureCaptured(
    id: string,
    attemptedAt: string,
    receiptId: string,
  ): ContinuityConversationTurnCapture;
}
