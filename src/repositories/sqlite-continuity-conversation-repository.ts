import type Database from "better-sqlite3";
import type {
  ContinuityConversation,
  ContinuityConversationTurnCapture,
  CreateContinuityConversationRecordInput,
  CreateContinuityConversationTurnCaptureInput,
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

interface TurnCaptureRow {
  id: string;
  conversation_id: string;
  external_turn_id: string;
  external_event_id: string;
  user_text: string;
  assistant_text: string;
  completed_at: string;
  context_format_version: number;
  memory_revision_ids_json: string;
  status: ContinuityConversationTurnCapture["status"];
  attempt_count: number;
  last_attempt_at: string | null;
  failure_code: string | null;
  receipt_id: string | null;
  captured_at: string | null;
  created_at: string;
  updated_at: string;
}

const columns = `
  id, user_id, persona_id, relationship_id, authorization_id, host_id,
  external_conversation_id, created_at
`;

const turnCaptureColumns = `
  id, conversation_id, external_turn_id, external_event_id, user_text,
  assistant_text, completed_at, context_format_version,
  memory_revision_ids_json, status, attempt_count, last_attempt_at,
  failure_code, receipt_id, captured_at, created_at, updated_at
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

function mapTurnCapture(row: TurnCaptureRow): ContinuityConversationTurnCapture {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    externalTurnId: row.external_turn_id,
    externalEventId: row.external_event_id,
    userText: row.user_text,
    assistantText: row.assistant_text,
    completedAt: row.completed_at,
    contextFormatVersion: row.context_format_version,
    memoryRevisionIds: JSON.parse(row.memory_revision_ids_json) as string[],
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    failureCode: row.failure_code,
    receiptId: row.receipt_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  public createTurnCapture(
    input: CreateContinuityConversationTurnCaptureInput,
  ): ContinuityConversationTurnCapture {
    try {
      this.database
        .prepare(
          `INSERT INTO continuity_conversation_turn_captures (
             id, conversation_id, external_turn_id, external_event_id,
             user_text, assistant_text, completed_at, context_format_version,
             memory_revision_ids_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.conversationId,
          input.externalTurnId,
          input.externalEventId,
          input.userText,
          input.assistantText,
          input.completedAt,
          input.contextFormatVersion,
          JSON.stringify(input.memoryRevisionIds),
        );
    } catch (error) {
      const existing = this.getTurnCaptureByTurn(
        input.conversationId,
        input.externalTurnId,
      );
      if (existing === null || !sameTurnCapture(existing, input)) {
        throw error;
      }
      return existing;
    }
    const capture = this.getTurnCapture(input.id);
    if (capture === null) {
      throw new Error("The conversation capture was created but could not be read back.");
    }
    return capture;
  }

  public getTurnCapture(id: string): ContinuityConversationTurnCapture | null {
    const row = this.database
      .prepare(
        `SELECT ${turnCaptureColumns}
         FROM continuity_conversation_turn_captures WHERE id = ?`,
      )
      .get(id) as TurnCaptureRow | undefined;
    return row === undefined ? null : mapTurnCapture(row);
  }

  public listRecoverableTurnCaptures(
    personaId: string,
  ): ContinuityConversationTurnCapture[] {
    return (
      this.database
        .prepare(
          `SELECT ${turnCaptureColumns
            .split(",")
            .map((column) => `capture.${column.trim()}`)
            .join(", ")}
           FROM continuity_conversation_turn_captures capture
           JOIN continuity_conversations conversation
             ON conversation.id = capture.conversation_id
           WHERE conversation.persona_id = ?
             AND capture.status IN ('pending', 'failed')
           ORDER BY capture.completed_at, capture.id`,
        )
        .all(personaId) as TurnCaptureRow[]
    ).map(mapTurnCapture);
  }

  public markTurnCaptureFailed(
    id: string,
    attemptedAt: string,
    failureCode: string,
  ): ContinuityConversationTurnCapture {
    const result = this.database
      .prepare(
        `UPDATE continuity_conversation_turn_captures
         SET status = 'failed',
             attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             failure_code = ?,
             receipt_id = NULL,
             captured_at = NULL,
             updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`,
      )
      .run(attemptedAt, failureCode, attemptedAt, id);
    if (result.changes !== 1) {
      throw new Error(`Recoverable conversation capture not found: ${id}`);
    }
    return this.requireTurnCapture(id);
  }

  public markTurnCaptureCaptured(
    id: string,
    attemptedAt: string,
    receiptId: string,
  ): ContinuityConversationTurnCapture {
    const current = this.requireTurnCapture(id);
    if (current.status === "captured") {
      if (current.receiptId !== receiptId) {
        throw new Error("A captured conversation turn cannot change receipts.");
      }
      return current;
    }
    const result = this.database
      .prepare(
        `UPDATE continuity_conversation_turn_captures
         SET status = 'captured',
             attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             failure_code = NULL,
             receipt_id = ?,
             captured_at = ?,
             updated_at = ?
         WHERE id = ? AND status IN ('pending', 'failed')`,
      )
      .run(attemptedAt, receiptId, attemptedAt, attemptedAt, id);
    if (result.changes !== 1) {
      throw new Error(`Recoverable conversation capture not found: ${id}`);
    }
    return this.requireTurnCapture(id);
  }

  public getTurnCaptureByTurn(
    conversationId: string,
    externalTurnId: string,
  ): ContinuityConversationTurnCapture | null {
    const row = this.database
      .prepare(
        `SELECT ${turnCaptureColumns}
         FROM continuity_conversation_turn_captures
         WHERE conversation_id = ? AND external_turn_id = ?`,
      )
      .get(conversationId, externalTurnId) as TurnCaptureRow | undefined;
    return row === undefined ? null : mapTurnCapture(row);
  }

  private requireTurnCapture(id: string): ContinuityConversationTurnCapture {
    const capture = this.getTurnCapture(id);
    if (capture === null) {
      throw new Error(`Conversation capture not found: ${id}`);
    }
    return capture;
  }
}

function sameTurnCapture(
  existing: ContinuityConversationTurnCapture,
  input: CreateContinuityConversationTurnCaptureInput,
): boolean {
  return (
    existing.conversationId === input.conversationId &&
    existing.externalTurnId === input.externalTurnId &&
    existing.externalEventId === input.externalEventId &&
    existing.userText === input.userText &&
    existing.assistantText === input.assistantText &&
    existing.completedAt === input.completedAt &&
    existing.contextFormatVersion === input.contextFormatVersion &&
    JSON.stringify(existing.memoryRevisionIds) ===
      JSON.stringify(input.memoryRevisionIds)
  );
}
