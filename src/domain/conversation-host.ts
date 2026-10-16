export const conversationTurnStatuses = [
  "completed",
  "interrupted",
  "failed",
] as const;

export type ConversationTurnStatus = (typeof conversationTurnStatuses)[number];

export interface ConversationHostIdentity {
  adapterId: string;
  adapterVersion: string;
}

export interface ConversationSession {
  /** Opaque identifier assigned by the conversation host. */
  id: string;
}

export const personaBehaviorPromptFormat = "memtextual.persona_behavior" as const;
export const personaBehaviorPromptFormatVersion = 1 as const;

/**
 * User-controlled persona behavior supplied as instructions when a host
 * conversation is created. This is configuration, not remembered user data,
 * and it does not grant tool, data, or memory-policy authority.
 */
export interface PersonaBehaviorPrompt {
  format: typeof personaBehaviorPromptFormat;
  formatVersion: typeof personaBehaviorPromptFormatVersion;
  contentRole: "persona_behavior";
  personaId: string;
  instructions: string;
}

export interface StartConversationInput {
  model?: string;
  personaBehavior?: PersonaBehaviorPrompt;
}

export type ConversationHostEvent =
  | {
      type: "turn-started";
      conversationId: string;
      turnId: string;
    }
  | {
      type: "assistant-delta";
      conversationId: string;
      turnId: string;
      delta: string;
    }
  | {
      type: "assistant-completed";
      conversationId: string;
      turnId: string;
      text: string;
    }
  | {
      type: "turn-completed";
      conversationId: string;
      turnId: string;
      status: ConversationTurnStatus;
    };

export interface SendConversationTurnInput {
  conversationId: string;
  text: string;
  memoryContext?: {
    contentRole: "memory_data";
    contextJson: string;
  };
  onEvent?: (event: ConversationHostEvent) => void;
}

export interface CompletedConversationTurn {
  conversationId: string;
  turnId: string;
  userText: string;
  assistantText: string;
  status: "completed";
}

export interface HistoricalCompletedConversationTurn
  extends CompletedConversationTurn {
  completedAt: string;
  memoryContext: {
    personaId: string;
    formatVersion: number;
    memoryRevisionIds: string[];
  };
}

/**
 * Provider-neutral boundary for a client-owned conversation. Host identifiers
 * are opaque and must not be interpreted by Continuity services.
 */
export interface ConversationHost {
  readonly identity: ConversationHostIdentity;
  startConversation(input?: StartConversationInput): Promise<ConversationSession>;
  resumeConversation(conversationId: string): Promise<ConversationSession>;
  sendTurn(input: SendConversationTurnInput): Promise<CompletedConversationTurn>;
  listCompletedTurns(
    conversationId: string,
  ): Promise<HistoricalCompletedConversationTurn[]>;
  close(): Promise<void>;
}
