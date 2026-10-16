import type { ContinuityConversation } from "./continuity-conversation.js";
import type { HostAuthorization } from "./host-event.js";

export interface ConversationGrantBinding {
  authorizationId: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  hostId: string;
}

export interface StoreConversationGrantInput extends ConversationGrantBinding {
  grant: string;
}

export interface ConversationGrantStoreReceipt {
  authorizationId: string;
  created: boolean;
}

export interface ConversationGrantStore {
  store(input: StoreConversationGrantInput): Promise<ConversationGrantStoreReceipt>;
  load(binding: ConversationGrantBinding): Promise<string | null>;
  delete(binding: ConversationGrantBinding): Promise<boolean>;
}

export function conversationGrantBindingFromAuthorization(
  authorization: HostAuthorization,
): ConversationGrantBinding {
  return {
    authorizationId: authorization.id,
    userId: authorization.userId,
    personaId: authorization.personaId,
    relationshipId: authorization.relationshipId,
    hostId: authorization.hostId,
  };
}

export function conversationGrantBindingFromConversation(
  conversation: ContinuityConversation,
): ConversationGrantBinding {
  return {
    authorizationId: conversation.authorizationId,
    userId: conversation.userId,
    personaId: conversation.personaId,
    relationshipId: conversation.relationshipId,
    hostId: conversation.hostId,
  };
}
