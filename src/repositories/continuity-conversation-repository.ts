import type {
  ContinuityConversation,
  CreateContinuityConversationRecordInput,
} from "../domain/continuity-conversation.js";

export interface ContinuityConversationRepository {
  createConversation(
    input: CreateContinuityConversationRecordInput,
  ): ContinuityConversation;
  getConversation(id: string): ContinuityConversation | null;
}
