import type { ConversationHostIdentity } from "../domain/conversation-host.js";
import type { ContinuityConversationTurnPayload } from "../domain/continuity-conversation.js";
import type { HostEventAdapter } from "../domain/host-event.js";

export class ContinuityConversationTurnAdapter
  implements HostEventAdapter<ContinuityConversationTurnPayload>
{
  readonly hostId: string;
  readonly version: string;

  public constructor(identity: ConversationHostIdentity) {
    this.hostId = identity.adapterId;
    this.version = identity.adapterVersion;
  }

  public toSource({
    event,
    personaContext,
  }: Parameters<HostEventAdapter<ContinuityConversationTurnPayload>["toSource"]>[0]) {
    return {
      kind: "chat" as const,
      title: `${personaContext.persona.name} conversation turn`,
      metadata: {
        continuityConversation: {
          conversationId: event.payload.conversationId,
          externalConversationId: event.payload.externalConversationId,
          turnId: event.payload.turnId,
          contextFormatVersion: event.payload.context.formatVersion,
          contextMemoryRevisionIds: event.payload.context.memoryRevisionIds,
        },
      },
      records: [
        {
          kind: "message" as const,
          authorRole: "user",
          content: event.payload.userText,
          ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
        },
        {
          kind: "message" as const,
          authorRole: "assistant",
          authorName: personaContext.persona.name,
          content: event.payload.assistantText,
          ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
        },
      ],
    };
  }
}
