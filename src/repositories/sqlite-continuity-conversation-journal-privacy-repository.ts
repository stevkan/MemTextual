import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ContinuityConversationJournalPurgeReceipt } from "../domain/continuity-conversation.js";
import type {
  ContinuityConversationJournalPrivacyRepository,
  ConversationJournalPurgeImpact,
  PurgeConversationJournalRecordInput,
} from "./continuity-conversation-journal-privacy-repository.js";

interface ReceiptRow {
  id: string;
  conversation_id: string;
  persona_id: string;
  deleted_row_counts_json: string;
  purged_at: string;
}

interface CountRow {
  count: number;
}

const targetSeriesSql = `
  SELECT DISTINCT series.id
  FROM continuity_conversations conversation
  JOIN continuity_conversation_turn_captures capture
    ON capture.conversation_id = conversation.id
  JOIN source_series series
    ON series.source_kind = 'chat'
   AND series.external_id =
       'continuity-host:' || conversation.authorization_id || ':' || capture.external_event_id
  WHERE conversation.id = ?
`;

export class SqliteContinuityConversationJournalPrivacyRepository
  implements ContinuityConversationJournalPrivacyRepository
{
  public constructor(private readonly database: Database.Database) {}

  public previewJournalPurge(
    conversationId: string,
    personaId: string,
  ): ConversationJournalPurgeImpact {
    const conversation = this.database
      .prepare(
        `SELECT id
         FROM continuity_conversations
         WHERE id = ? AND persona_id = ?`,
      )
      .get(conversationId, personaId);
    if (conversation === undefined) {
      throw new Error(`Continuity conversation not found: ${conversationId}`);
    }
    const alreadyPurged =
      this.getJournalPurgeReceipt(conversationId) !== null;
    const hostDeletionConfirmed =
      this.database
        .prepare(
          `SELECT 1 AS present
           FROM continuity_conversation_host_deletions
           WHERE conversation_id = ? AND status = 'deleted'`,
        )
        .get(conversationId) !== undefined;
    const count = (sql: string): number =>
      (this.database.prepare(sql).get(conversationId) as CountRow).count;
    const turnCount = count(
      `SELECT count(*) AS count
       FROM continuity_conversation_turn_captures
       WHERE conversation_id = ?`,
    );
    const sourceSeriesCount = count(
      `SELECT count(*) AS count FROM (${targetSeriesSql})`,
    );
    const sourceRecordCount = count(
      `SELECT count(*) AS count
       FROM source_records record
       JOIN source_versions version ON version.source_id = record.source_id
       WHERE version.series_id IN (${targetSeriesSql})`,
    );
    const hostEventCount = count(
      `SELECT count(*) AS count
       FROM continuity_host_events event
       WHERE event.source_id IN (
         SELECT version.source_id
         FROM source_versions version
         WHERE version.series_id IN (${targetSeriesSql})
       )`,
    );
    const candidateCount = count(
      `SELECT count(DISTINCT evidence.candidate_id) AS count
       FROM candidate_evidence evidence
       JOIN source_records record ON record.id = evidence.source_record_id
       JOIN source_versions version ON version.source_id = record.source_id
       WHERE version.series_id IN (${targetSeriesSql})`,
    );
    const dependentMemoryIds = this.database
      .prepare(
        `SELECT DISTINCT revision.memory_id AS id
         FROM memory_evidence evidence
         JOIN source_records record ON record.id = evidence.source_record_id
         JOIN source_versions version ON version.source_id = record.source_id
         JOIN memory_revisions revision ON revision.id = evidence.memory_revision_id
         WHERE version.series_id IN (${targetSeriesSql})
         ORDER BY revision.memory_id`,
      )
      .all(conversationId)
      .map((row) => (row as { id: string }).id);
    const activeReviewPolicyIds = this.database
      .prepare(
        `SELECT DISTINCT policy.id
         FROM review_policies policy,
              json_each(policy.conditions_json, '$.trustedSources') trusted
         WHERE policy.is_active = 1
           AND EXISTS (
             SELECT 1
             FROM source_series series
             WHERE series.id IN (${targetSeriesSql})
               AND json_extract(trusted.value, '$.kind') = series.source_kind
               AND json_extract(trusted.value, '$.externalId') = series.external_id
           )
         ORDER BY policy.id`,
      )
      .all(conversationId)
      .map((row) => (row as { id: string }).id);
    const missingCapturedSourceCount = count(
      `SELECT count(*) AS count
       FROM continuity_conversation_turn_captures capture
       JOIN continuity_conversations conversation
         ON conversation.id = capture.conversation_id
       WHERE capture.conversation_id = ?
         AND capture.status = 'captured'
         AND NOT EXISTS (
           SELECT 1
           FROM source_series series
           WHERE series.source_kind = 'chat'
             AND series.external_id =
                 'continuity-host:' || conversation.authorization_id || ':' || capture.external_event_id
         )`,
    );

    const blockers: string[] = [];
    if (alreadyPurged) {
      blockers.push("The local conversation journal was already purged.");
    }
    if (!hostDeletionConfirmed) {
      blockers.push(
        "The external host thread must have provider-confirmed deletion before local purge.",
      );
    }
    if (dependentMemoryIds.length > 0) {
      blockers.push("Retained memories still depend on this conversation evidence.");
    }
    if (activeReviewPolicyIds.length > 0) {
      blockers.push("Active review policies still trust a captured source identity.");
    }
    if (missingCapturedSourceCount > 0) {
      blockers.push("Captured turns have incomplete source provenance.");
    }

    const basis = {
      conversationId,
      personaId,
      hostDeletionConfirmed,
      alreadyPurged,
      turnCount,
      hostEventCount,
      sourceSeriesCount,
      sourceRecordCount,
      candidateCount,
      dependentMemoryIds,
      activeReviewPolicyIds,
      blockers,
      canPurge: blockers.length === 0,
    };
    return {
      ...basis,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(basis), "utf8")
        .digest("hex"),
    };
  }

  public purgeJournal(
    input: PurgeConversationJournalRecordInput,
  ): ContinuityConversationJournalPurgeReceipt {
    let receipt!: ContinuityConversationJournalPurgeReceipt;
    const purge = this.database.transaction(() => {
      const preview = this.previewJournalPurge(
        input.conversationId,
        input.personaId,
      );
      if (preview.fingerprint !== input.expectedFingerprint) {
        throw new Error("The conversation journal purge preview is stale.");
      }
      if (!preview.canPurge) {
        throw new Error(
          `Conversation journal cannot be purged: ${preview.blockers.join(" ")}`,
        );
      }

      const seriesIds = this.database
        .prepare(targetSeriesSql)
        .all(input.conversationId)
        .map((row) => (row as { id: string }).id);
      const seriesIdsJson = JSON.stringify(seriesIds);
      const sourceIds = this.database
        .prepare(
          `SELECT source_id AS id
           FROM source_versions
           WHERE series_id IN (SELECT value FROM json_each(?))
           ORDER BY source_id`,
        )
        .all(seriesIdsJson)
        .map((row) => (row as { id: string }).id);
      const sourceIdsJson = JSON.stringify(sourceIds);
      const candidateIds = this.database
        .prepare(
          `SELECT DISTINCT evidence.candidate_id AS id
           FROM candidate_evidence evidence
           JOIN source_records record ON record.id = evidence.source_record_id
           WHERE record.source_id IN (SELECT value FROM json_each(?))
           ORDER BY evidence.candidate_id`,
        )
        .all(sourceIdsJson)
        .map((row) => (row as { id: string }).id);
      const candidateIdsJson = JSON.stringify(candidateIds);
      const countBySeries = (sql: string): number =>
        (this.database.prepare(sql).get(seriesIdsJson) as CountRow).count;
      const sourceDeletionEventCount = countBySeries(
        `SELECT count(*) AS count
         FROM source_series_deletion_events event
         WHERE event.series_id IN (SELECT value FROM json_each(?))`,
      );
      const sourceDeletionSourceCount = countBySeries(
        `SELECT count(*) AS count
         FROM source_series_deletion_sources tracked
         JOIN source_series_deletion_events event
           ON event.id = tracked.deletion_event_id
         WHERE event.series_id IN (SELECT value FROM json_each(?))`,
      );
      const sourceDeletionRecordCount = countBySeries(
        `SELECT count(*) AS count
         FROM source_series_deletion_records tracked
         JOIN source_series_deletion_events event
           ON event.id = tracked.deletion_event_id
         WHERE event.series_id IN (SELECT value FROM json_each(?))`,
      );
      const deletedRowCounts: Record<string, number> = {
        conversationTurnCaptures: preview.turnCount,
        hostEvents: preview.hostEventCount,
        sourceSeries: preview.sourceSeriesCount,
        sourceVersions: sourceIds.length,
        sources: sourceIds.length,
        sourceRecords: preview.sourceRecordCount,
        sourceDeletionEvents: sourceDeletionEventCount,
        sourceDeletionSources: sourceDeletionSourceCount,
        sourceDeletionRecords: sourceDeletionRecordCount,
        memoryCandidates: preview.candidateCount,
      };
      this.database
        .prepare(
          `INSERT INTO continuity_conversation_journal_purge_receipts (
             id, conversation_id, persona_id, reason,
             deleted_row_counts_json, purged_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.receiptId,
          input.conversationId,
          input.personaId,
          input.reason,
          JSON.stringify(deletedRowCounts),
          input.purgedAt,
        );
      this.database
        .prepare(
          `DELETE FROM continuity_conversation_turn_captures
           WHERE conversation_id = ?`,
        )
        .run(input.conversationId);
      this.database
        .prepare(
          `DELETE FROM continuity_host_events
           WHERE source_id IN (SELECT value FROM json_each(?))`,
        )
        .run(sourceIdsJson);
      this.database
        .prepare(
          `DELETE FROM memory_candidates
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .run(candidateIdsJson);
      this.database
        .prepare(
          `DELETE FROM source_versions
           WHERE series_id IN (SELECT value FROM json_each(?))`,
        )
        .run(seriesIdsJson);
      this.database
        .prepare(
          `DELETE FROM source_series
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .run(seriesIdsJson);
      this.database
        .prepare(
          `DELETE FROM sources
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .run(sourceIdsJson);

      receipt = this.requireReceipt(input.conversationId);
    });
    purge();
    return receipt;
  }

  public getJournalPurgeReceipt(
    conversationId: string,
  ): ContinuityConversationJournalPurgeReceipt | null {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, persona_id,
                deleted_row_counts_json, purged_at
         FROM continuity_conversation_journal_purge_receipts
         WHERE conversation_id = ?`,
      )
      .get(conversationId) as ReceiptRow | undefined;
    return row === undefined ? null : mapReceipt(row);
  }

  private requireReceipt(
    conversationId: string,
  ): ContinuityConversationJournalPurgeReceipt {
    const receipt = this.getJournalPurgeReceipt(conversationId);
    if (receipt === null) {
      throw new Error(`Conversation journal purge receipt not found: ${conversationId}`);
    }
    return receipt;
  }
}

function mapReceipt(row: ReceiptRow): ContinuityConversationJournalPurgeReceipt {
  return {
    receiptId: row.id,
    conversationId: row.conversation_id,
    personaId: row.persona_id,
    purgedAt: row.purged_at,
    deletedRowCounts: JSON.parse(row.deleted_row_counts_json) as Record<
      string,
      number
    >,
    externalCopiesNotModified: true,
  };
}
