import type Database from "better-sqlite3";
import type {
  ContinuityConversation,
  CreateContinuityConversationRecordInput,
} from "../domain/continuity-conversation.js";
import type { ContinuityConversationRepository } from "./continuity-conversation-repository.js";

interface ConversationRow {
  id: string;
  user_id: string;
  persona_id: string;
  relationship_id: string;
  authorization_id: string;
  host_id: string;
  external_conversation_id: string;
  created_at: string;
}

const columns = `
  id, user_id, persona_id, relationship_id, authorization_id, host_id,
  external_conversation_id, created_at
`;

function mapConversation(row: ConversationRow): ContinuityConversation {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    relationshipId: row.relationship_id,
    authorizationId: row.authorization_id,
    hostId: row.host_id,
    externalConversationId: row.external_conversation_id,
    createdAt: row.created_at,
  };
}

export class SqliteContinuityConversationRepository
  implements ContinuityConversationRepository
{
  public constructor(private readonly database: Database.Database) {}

  public createConversation(
    input: CreateContinuityConversationRecordInput,
  ): ContinuityConversation {
    this.database
      .prepare(
        `INSERT INTO continuity_conversations (
           id, user_id, persona_id, relationship_id, authorization_id,
           host_id, external_conversation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.personaId,
        input.relationshipId,
        input.authorizationId,
        input.hostId,
        input.externalConversationId,
      );
    const conversation = this.getConversation(input.id);
    if (conversation === null) {
      throw new Error("The Continuity conversation was created but could not be read back.");
    }
    return conversation;
  }

  public getConversation(id: string): ContinuityConversation | null {
    const row = this.database
      .prepare(`SELECT ${columns} FROM continuity_conversations WHERE id = ?`)
      .get(id) as ConversationRow | undefined;
    return row === undefined ? null : mapConversation(row);
  }
}
