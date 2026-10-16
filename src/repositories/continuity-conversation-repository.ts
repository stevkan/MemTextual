import type {
  ContinuityConversation,
  ContinuityConversationHostDeletion,
  ContinuityConversationSummary,
  ContinuityConversationTurnCapture,
  CreateContinuityConversationRecordInput,
  CreateContinuityConversationTurnCaptureInput,
} from "../domain/continuity-conversation.js";

export interface ContinuityConversationRepository {
  createConversation(
    input: CreateContinuityConversationRecordInput,
  ): ContinuityConversation;
  getConversation(id: string): ContinuityConversation | null;
  getHostDeletion(conversationId: string): ContinuityConversationHostDeletion | null;
  beginHostDeletion(
    conversationId: string,
    attemptedAt: string,
  ): ContinuityConversationHostDeletion;
  markHostDeletionFailed(
    conversationId: string,
    attemptedAt: string,
    failureCode: string,
  ): ContinuityConversationHostDeletion;
  markHostDeleted(
    conversationId: string,
    attemptedAt: string,
  ): ContinuityConversationHostDeletion;
  listConversations(personaId: string): ContinuityConversationSummary[];
  listConversationTurnCaptures(
    conversationId: string,
    personaId: string,
  ): ContinuityConversationTurnCapture[];
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
