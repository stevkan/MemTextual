import type Database from "better-sqlite3";
import type {
  ContinuityConversation,
  ContinuityConversationHostDeletion,
  ContinuityConversationJournalPurgeReceipt,
  ContinuityConversationSummary,
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
  behavior_profile_id: string | null;
  behavior_profile_revision: number | null;
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

interface ConversationSummaryRow extends ConversationRow {
  deletion_status: ContinuityConversationHostDeletion["status"] | null;
  deletion_attempt_count: number | null;
  deletion_last_attempt_at: string | null;
  deletion_failure_code: string | null;
  host_deleted_at: string | null;
  deletion_updated_at: string | null;
  journal_purge_id: string | null;
  journal_purge_persona_id: string | null;
  journal_purge_counts_json: string | null;
  journal_purged_at: string | null;
  turn_count: number;
  unresolved_capture_count: number;
  last_activity_at: string;
}

interface HostDeletionRow {
  conversation_id: string;
  status: ContinuityConversationHostDeletion["status"];
  attempt_count: number;
  last_attempt_at: string;
  failure_code: string | null;
  deleted_at: string | null;
  updated_at: string;
}

const columns = `
  id, user_id, persona_id, relationship_id, authorization_id, host_id,
  external_conversation_id, behavior_profile_id, behavior_profile_revision,
  created_at
`;

const turnCaptureColumns = `
  id, conversation_id, external_turn_id, external_event_id, user_text,
  assistant_text, completed_at, context_format_version,
  memory_revision_ids_json, status, attempt_count, last_attempt_at,
  failure_code, receipt_id, captured_at, created_at, updated_at
`;

const hostDeletionColumns = `
  conversation_id, status, attempt_count, last_attempt_at, failure_code,
  deleted_at, updated_at
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
    behaviorProfileId: row.behavior_profile_id,
    behaviorProfileRevision: row.behavior_profile_revision,
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

function mapHostDeletion(
  row: HostDeletionRow,
): ContinuityConversationHostDeletion {
  return {
    conversationId: row.conversation_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    failureCode: row.failure_code,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationSummary(
  row: ConversationSummaryRow,
): ContinuityConversationSummary {
  return {
    conversation: mapConversation(row),
    hostDeletion:
      row.deletion_status === null
        ? null
        : mapHostDeletion({
            conversation_id: row.id,
            status: row.deletion_status,
            attempt_count: row.deletion_attempt_count!,
            last_attempt_at: row.deletion_last_attempt_at!,
            failure_code: row.deletion_failure_code,
            deleted_at: row.host_deleted_at,
            updated_at: row.deletion_updated_at!,
          }),
    journalPurge:
      row.journal_purge_id === null
        ? null
        : mapJournalPurgeReceipt({
            id: row.journal_purge_id,
            conversationId: row.id,
            personaId: row.journal_purge_persona_id!,
            countsJson: row.journal_purge_counts_json!,
            purgedAt: row.journal_purged_at!,
          }),
    turnCount: row.turn_count,
    unresolvedCaptureCount: row.unresolved_capture_count,
    lastActivityAt: row.last_activity_at,
  };
}

function mapJournalPurgeReceipt(input: {
  id: string;
  conversationId: string;
  personaId: string;
  countsJson: string;
  purgedAt: string;
}): ContinuityConversationJournalPurgeReceipt {
  return {
    receiptId: input.id,
    conversationId: input.conversationId,
    personaId: input.personaId,
    purgedAt: input.purgedAt,
    deletedRowCounts: JSON.parse(input.countsJson) as Record<string, number>,
    externalCopiesNotModified: true,
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
           host_id, external_conversation_id, behavior_profile_id,
           behavior_profile_revision
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.personaId,
        input.relationshipId,
        input.authorizationId,
        input.hostId,
        input.externalConversationId,
        input.behaviorProfileId,
        input.behaviorProfileRevision,
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

  public getHostDeletion(
    conversationId: string,
  ): ContinuityConversationHostDeletion | null {
    const row = this.database
      .prepare(
        `SELECT ${hostDeletionColumns}
         FROM continuity_conversation_host_deletions
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as HostDeletionRow | undefined;
    return row === undefined ? null : mapHostDeletion(row);
  }

  public beginHostDeletion(
    conversationId: string,
    attemptedAt: string,
  ): ContinuityConversationHostDeletion {
    const current = this.getHostDeletion(conversationId);
    if (current?.status === "deleted") {
      return current;
    }
    this.database
      .prepare(
        `INSERT INTO continuity_conversation_host_deletions (
           conversation_id, status, attempt_count, last_attempt_at, updated_at
         ) VALUES (?, 'pending', 1, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           status = 'pending',
           attempt_count = attempt_count + 1,
           last_attempt_at = excluded.last_attempt_at,
           failure_code = NULL,
           deleted_at = NULL,
           updated_at = excluded.updated_at
         WHERE continuity_conversation_host_deletions.status IN ('pending', 'failed')`,
      )
      .run(conversationId, attemptedAt, attemptedAt);
    return this.requireHostDeletion(conversationId);
  }

  public markHostDeletionFailed(
    conversationId: string,
    attemptedAt: string,
    failureCode: string,
  ): ContinuityConversationHostDeletion {
    const result = this.database
      .prepare(
        `UPDATE continuity_conversation_host_deletions
         SET status = 'failed', failure_code = ?, deleted_at = NULL, updated_at = ?
         WHERE conversation_id = ? AND status = 'pending'
           AND last_attempt_at = ?`,
      )
      .run(failureCode, attemptedAt, conversationId, attemptedAt);
    if (result.changes !== 1) {
      throw new Error(`Pending conversation host deletion not found: ${conversationId}`);
    }
    return this.requireHostDeletion(conversationId);
  }

  public markHostDeleted(
    conversationId: string,
    attemptedAt: string,
  ): ContinuityConversationHostDeletion {
    const current = this.requireHostDeletion(conversationId);
    if (current.status === "deleted") {
      return current;
    }
    const result = this.database
      .prepare(
        `UPDATE continuity_conversation_host_deletions
         SET status = 'deleted', failure_code = NULL, deleted_at = ?, updated_at = ?
         WHERE conversation_id = ? AND status = 'pending'
           AND last_attempt_at = ?`,
      )
      .run(attemptedAt, attemptedAt, conversationId, attemptedAt);
    if (result.changes !== 1) {
      throw new Error(`Pending conversation host deletion not found: ${conversationId}`);
    }
    return this.requireHostDeletion(conversationId);
  }

  public listConversations(personaId: string): ContinuityConversationSummary[] {
    const prefixedColumns = columns
      .split(",")
      .map((column) => `conversation.${column.trim()}`)
      .join(", ");
    const rows = this.database
      .prepare(
        `SELECT ${prefixedColumns},
                deletion.status AS deletion_status,
                deletion.attempt_count AS deletion_attempt_count,
                deletion.last_attempt_at AS deletion_last_attempt_at,
                deletion.failure_code AS deletion_failure_code,
                deletion.deleted_at AS host_deleted_at,
                deletion.updated_at AS deletion_updated_at,
                purge.id AS journal_purge_id,
                purge.persona_id AS journal_purge_persona_id,
                purge.deleted_row_counts_json AS journal_purge_counts_json,
                purge.purged_at AS journal_purged_at,
                COUNT(capture.id) AS turn_count,
                COALESCE(SUM(CASE WHEN capture.status IN ('pending', 'failed')
                                  THEN 1 ELSE 0 END), 0)
                  AS unresolved_capture_count,
                MAX(
                  conversation.created_at,
                  COALESCE(MAX(capture.completed_at), conversation.created_at),
                  COALESCE(purge.purged_at, conversation.created_at)
                ) AS last_activity_at
         FROM continuity_conversations conversation
         LEFT JOIN continuity_conversation_turn_captures capture
           ON capture.conversation_id = conversation.id
         LEFT JOIN continuity_conversation_host_deletions deletion
           ON deletion.conversation_id = conversation.id
         LEFT JOIN continuity_conversation_journal_purge_receipts purge
           ON purge.conversation_id = conversation.id
         WHERE conversation.persona_id = ?
         GROUP BY conversation.id
         ORDER BY last_activity_at DESC, conversation.id DESC`,
      )
      .all(personaId) as ConversationSummaryRow[];
    return rows.map(mapConversationSummary);
  }

  public listConversationTurnCaptures(
    conversationId: string,
    personaId: string,
  ): ContinuityConversationTurnCapture[] {
    const prefixedColumns = turnCaptureColumns
      .split(",")
      .map((column) => `capture.${column.trim()}`)
      .join(", ");
    const rows = this.database
      .prepare(
        `SELECT ${prefixedColumns}
         FROM continuity_conversation_turn_captures capture
         JOIN continuity_conversations conversation
           ON conversation.id = capture.conversation_id
         WHERE capture.conversation_id = ? AND conversation.persona_id = ?
         ORDER BY capture.completed_at, capture.created_at, capture.id`,
      )
      .all(conversationId, personaId) as TurnCaptureRow[];
    return rows.map(mapTurnCapture);
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

  private requireHostDeletion(
    conversationId: string,
  ): ContinuityConversationHostDeletion {
    const deletion = this.getHostDeletion(conversationId);
    if (deletion === null) {
      throw new Error(`Conversation host deletion not found: ${conversationId}`);
    }
    return deletion;
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
