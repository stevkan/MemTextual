import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type {
  CandidateAcceptance,
  CandidateActor,
  CandidateEvidence,
  CandidateMatch,
  CandidateResolution,
  CandidateResolutionInput,
  CandidateResolutionKind,
  CandidateResolutionResult,
  CandidateStatus,
  DeleteSourceSeriesInput,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceKind,
  SourceRecord,
  SourceSeriesIdentity,
  SourceSeriesPurgePreview,
  SourceSeriesPurgeReceipt,
  SourceRecordKind,
} from "../domain/ingestion.js";
import { candidateResolutionKinds } from "../domain/ingestion.js";
import { personaMemoryClasses } from "../domain/continuity-memory.js";
import type {
  Explicitness,
  MemoryType,
  RetrievalPolicy,
  Sensitivity,
} from "../domain/memory.js";
import type { PolicyAcceptanceAuthorization } from "../domain/review-policy.js";
import type { IngestionRepository } from "./ingestion-repository.js";
import type { MemoryRepository } from "./memory-repository.js";

interface SourceRow {
  id: string;
  source_kind: SourceKind;
  title: string;
  origin_uri: string | null;
  external_id: string | null;
  content_hash: string;
  captured_at: string | null;
  metadata_json: string;
  created_at: string;
  record_count: number;
  series_id: string | null;
  version_number: number | null;
  previous_source_id: string | null;
  version_reason: string | null;
  is_current: 0 | 1;
  deleted_at: string | null;
  deletion_reason: string | null;
}

interface SourceSeriesRow {
  id: string;
  current_source_id: string;
  next_version: number;
}

interface SourceSeriesLifecycleRow {
  id: string;
  is_deleted: 0 | 1;
}

interface SourceRecordRow {
  id: string;
  source_id: string;
  ordinal: number;
  record_kind: SourceRecordKind;
  author_role: string | null;
  author_name: string | null;
  content: string;
  content_hash: string;
  occurred_at: string | null;
  metadata_json: string;
  created_at: string;
}

interface CandidateRow {
  id: string;
  external_id: string | null;
  status: CandidateStatus;
  memory_type: MemoryType;
  assertion: string;
  normalized_assertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  observed_at: string | null;
  retrieval_policy: RetrievalPolicy;
  sensitivity: Sensitivity;
  is_pinned: 0 | 1;
  is_protected: 0 | 1;
  scope_id: string;
  proposed_by: CandidateActor;
  proposer_id: string | null;
  reviewed_by: CandidateActor | null;
  reviewed_at: string | null;
  review_note: string | null;
  accepted_memory_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface CandidateEvidenceRow {
  source_record_id: string;
  evidence_role: CandidateEvidence["role"];
  excerpt: string | null;
}

interface CandidateResolutionRow {
  candidate_id: string;
  outcome: CandidateResolutionKind;
  target_memory_id: string | null;
  result_memory_id: string | null;
  actor_type: CandidateActor;
  note: string | null;
  resolved_at: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function validateText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return trimmed;
}

function validateConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Candidate confidence must be between 0 and 1.");
  }
  return value;
}

function normalizeForExactMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replaceAll(/[\p{P}\p{S}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function mapSource(row: SourceRow): Source {
  return {
    id: row.id,
    kind: row.source_kind,
    title: row.title,
    originUri: row.origin_uri,
    externalId: row.external_id,
    contentHash: row.content_hash,
    capturedAt: row.captured_at,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
    recordCount: row.record_count,
    seriesId: row.series_id,
    versionNumber: row.version_number,
    previousSourceId: row.previous_source_id,
    versionReason: row.version_reason,
    isCurrent: row.is_current === 1,
    deletedAt: row.deleted_at,
    deletionReason: row.deletion_reason,
  };
}

function mapSourceRecord(row: SourceRecordRow): SourceRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    ordinal: row.ordinal,
    kind: row.record_kind,
    authorRole: row.author_role,
    authorName: row.author_name,
    content: row.content,
    contentHash: row.content_hash,
    occurredAt: row.occurred_at,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export class SqliteIngestionRepository implements IngestionRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly memoryRepository: MemoryRepository,
  ) {}

  public importSource(input: ImportSourceInput): SourceImportResult {
    const title = validateText(input.title, "A source title");
    if (input.records.length === 0) {
      throw new Error("A source import requires at least one record.");
    }

    for (const record of input.records) {
      if (record.content.trim().length === 0) {
        throw new Error("A source record cannot be empty.");
      }
    }

    const externalId = input.externalId?.trim();
    if (externalId !== undefined && externalId.length === 0) {
      throw new Error("A source external ID cannot be empty.");
    }
    if (input.createVersion === true && externalId === undefined) {
      throw new Error("Creating a source version requires an external ID.");
    }
    const versionReason = input.versionReason?.trim();
    if (input.versionReason !== undefined && versionReason?.length === 0) {
      throw new Error("A source version reason cannot be empty.");
    }

    const canonicalRecords = input.records.map((record) => ({
      kind: record.kind,
      content: record.content,
      authorRole: record.authorRole ?? null,
      authorName: record.authorName ?? null,
      occurredAt: record.occurredAt ?? null,
      metadata: record.metadata ?? {},
    }));
    const contentHash = sha256(canonicalJson(canonicalRecords));

    const existing =
      externalId === undefined
        ? this.findSourceByHash(input.kind, contentHash)
        : this.findSourceByExternalId(input.kind, externalId);

    if (existing !== null) {
      if (existing.deletedAt !== null) {
        throw new Error(
          `Source ${input.kind}:${externalId} is deleted. Restore the source series before importing it again.`,
        );
      }
      if (existing.contentHash !== contentHash) {
        if (input.createVersion !== true || externalId === undefined) {
          throw new Error(
            `Source ${input.kind}:${externalId} already exists with different content. Set createVersion to true to preserve both versions.`,
          );
        }
        return this.createSourceVersion(
          input,
          title,
          externalId,
          contentHash,
          existing,
          versionReason,
        );
      }
      return {
        source: existing,
        records: this.getSourceRecords(existing.id),
        created: false,
      };
    }

    const sourceId = randomUUID();
    const seriesId = externalId === undefined ? null : randomUUID();
    const importTransaction = this.database.transaction(() => {
      this.insertSource(sourceId, externalId ?? null, title, contentHash, input);
      if (seriesId !== null && externalId !== undefined) {
        this.database
          .prepare(
            `INSERT INTO source_series (
               id, source_kind, external_id, current_source_id
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(seriesId, input.kind, externalId, sourceId);
        this.database
          .prepare(
            `INSERT INTO source_versions (
               source_id, series_id, version_number, version_reason
             ) VALUES (?, ?, 1, ?)`,
          )
          .run(sourceId, seriesId, versionReason ?? null);
      }
    });

    importTransaction();
    return {
      source: this.requireSource(sourceId),
      records: this.getSourceRecords(sourceId),
      created: true,
    };
  }

  public listSources(limit = 100): Source[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT
           s.id, s.source_kind, s.title, s.origin_uri,
           COALESCE(ss.external_id, s.external_id) AS external_id,
           s.content_hash, s.captured_at, s.metadata_json, s.created_at, s.deleted_at,
           count(r.id) AS record_count,
           sv.series_id, sv.version_number, sv.previous_source_id, sv.version_reason,
           (SELECT sde.reason FROM source_series_deletion_events sde
            WHERE sde.series_id = sv.series_id AND sde.restored_at IS NULL) AS deletion_reason,
           CASE WHEN sv.source_id IS NULL OR ss.current_source_id = s.id THEN 1 ELSE 0 END AS is_current
         FROM sources s
         LEFT JOIN source_records r ON r.source_id = s.id AND r.deleted_at IS NULL
         LEFT JOIN source_versions sv ON sv.source_id = s.id
         LEFT JOIN source_series ss ON ss.id = sv.series_id
         WHERE s.deleted_at IS NULL
           AND (sv.source_id IS NULL OR ss.current_source_id = s.id)
         GROUP BY s.id
         ORDER BY s.created_at DESC, s.id
         LIMIT ?`,
      )
      .all(safeLimit) as SourceRow[];
    return rows.map(mapSource);
  }

  public getSourceHistory(kind: SourceKind, externalId: string): Source[] {
    const normalized = validateText(externalId, "A source external ID");
    const rows = this.database
      .prepare(
        `${this.sourceSelect()}
         WHERE ss.source_kind = ? AND ss.external_id = ?
         ORDER BY sv.version_number ASC`,
      )
      .all(kind, normalized) as SourceRow[];
    return rows.map(mapSource);
  }

  public deleteSourceSeries(
    input: DeleteSourceSeriesInput,
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): Source[] {
    this.requireExplicitSourceAction(actor, explicitUserAction, "delete");
    const externalId = validateText(input.externalId, "A source external ID");
    const reason = validateText(input.reason, "A source deletion reason");
    const series = this.requireSourceSeries({ kind: input.kind, externalId });
    if (series.is_deleted === 1) {
      throw new Error(`Source series ${input.kind}:${externalId} is already deleted.`);
    }

    const deletionTransaction = this.database.transaction(() => {
      const eventId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO source_series_deletion_events (
             id, series_id, reason, actor_type
           ) VALUES (?, ?, ?, 'user')`,
        )
        .run(eventId, series.id, reason);

      const sources = this.database
        .prepare(
          `SELECT s.id, s.deleted_at
           FROM source_versions sv
           JOIN sources s ON s.id = sv.source_id
           WHERE sv.series_id = ?`,
        )
        .all(series.id) as Array<{ id: string; deleted_at: string | null }>;
      const records = this.database
        .prepare(
          `SELECT r.id, r.deleted_at
           FROM source_versions sv
           JOIN source_records r ON r.source_id = sv.source_id
           WHERE sv.series_id = ?`,
        )
        .all(series.id) as Array<{ id: string; deleted_at: string | null }>;

      const trackSource = this.database.prepare(
        `INSERT INTO source_series_deletion_sources (
           deletion_event_id, source_id, previous_deleted_at
         ) VALUES (?, ?, ?)`,
      );
      for (const source of sources) {
        trackSource.run(eventId, source.id, source.deleted_at);
      }
      const trackRecord = this.database.prepare(
        `INSERT INTO source_series_deletion_records (
           deletion_event_id, source_record_id, previous_deleted_at
         ) VALUES (?, ?, ?)`,
      );
      for (const record of records) {
        trackRecord.run(eventId, record.id, record.deleted_at);
      }

      this.database
        .prepare(
          `UPDATE source_records
           SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE source_id IN (
             SELECT source_id FROM source_versions WHERE series_id = ?
           )`,
        )
        .run(series.id);
      this.database
        .prepare(
          `UPDATE sources
           SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id IN (
             SELECT source_id FROM source_versions WHERE series_id = ?
           )`,
        )
        .run(series.id);
    });
    deletionTransaction();
    return this.getSourceHistory(input.kind, externalId);
  }

  public restoreSourceSeries(
    input: SourceSeriesIdentity,
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): Source[] {
    this.requireExplicitSourceAction(actor, explicitUserAction, "restore");
    const externalId = validateText(input.externalId, "A source external ID");
    const series = this.requireSourceSeries({ kind: input.kind, externalId });
    const restoreTransaction = this.database.transaction(() => {
      const event = this.database
        .prepare(
          `SELECT id FROM source_series_deletion_events
           WHERE series_id = ? AND restored_at IS NULL AND is_recoverable = 1`,
        )
        .get(series.id) as { id: string } | undefined;
      if (event === undefined) {
        throw new Error(
          `Source series ${input.kind}:${externalId} has no recoverable deletion record.`,
        );
      }
      const sources = this.database
        .prepare(
          `SELECT source_id, previous_deleted_at
           FROM source_series_deletion_sources WHERE deletion_event_id = ?`,
        )
        .all(event.id) as Array<{
        source_id: string;
        previous_deleted_at: string | null;
      }>;
      const records = this.database
        .prepare(
          `SELECT source_record_id, previous_deleted_at
           FROM source_series_deletion_records WHERE deletion_event_id = ?`,
        )
        .all(event.id) as Array<{
        source_record_id: string;
        previous_deleted_at: string | null;
      }>;
      const restoreSource = this.database.prepare(
        "UPDATE sources SET deleted_at = ? WHERE id = ?",
      );
      for (const source of sources) {
        restoreSource.run(source.previous_deleted_at, source.source_id);
      }
      const restoreRecord = this.database.prepare(
        "UPDATE source_records SET deleted_at = ? WHERE id = ?",
      );
      for (const record of records) {
        restoreRecord.run(record.previous_deleted_at, record.source_record_id);
      }
      this.database
        .prepare(
          `UPDATE source_series_deletion_events
           SET restored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(event.id);
    });
    restoreTransaction();
    return this.getSourceHistory(input.kind, externalId);
  }

  public previewSourceSeriesPurge(
    input: SourceSeriesIdentity,
  ): SourceSeriesPurgePreview {
    const externalId = validateText(input.externalId, "A source external ID");
    const series = this.requireSourceSeries({ kind: input.kind, externalId });
    const dependentMemoryIds = this.database
      .prepare(
        `SELECT DISTINCT mr.memory_id AS id
         FROM source_versions sv
         JOIN source_records sr ON sr.source_id = sv.source_id
         JOIN memory_evidence me ON me.source_record_id = sr.id
         JOIN memory_revisions mr ON mr.id = me.memory_revision_id
         WHERE sv.series_id = ?
         ORDER BY mr.memory_id`,
      )
      .all(series.id)
      .map((row) => (row as { id: string }).id);
    const dependentCandidateIds = this.database
      .prepare(
        `SELECT DISTINCT ce.candidate_id AS id
         FROM source_versions sv
         JOIN source_records sr ON sr.source_id = sv.source_id
         JOIN candidate_evidence ce ON ce.source_record_id = sr.id
         WHERE sv.series_id = ?
         ORDER BY ce.candidate_id`,
      )
      .all(series.id)
      .map((row) => (row as { id: string }).id);
    const activeReviewPolicyIds = this.database
      .prepare(
        `SELECT DISTINCT rp.id
         FROM review_policies rp, json_each(rp.conditions_json, '$.trustedSources') trusted
         WHERE rp.is_active = 1
           AND json_extract(trusted.value, '$.kind') = ?
           AND json_extract(trusted.value, '$.externalId') = ?
         ORDER BY rp.id`,
      )
      .all(input.kind, externalId)
      .map((row) => (row as { id: string }).id);
    const counts = this.database
      .prepare(
        `SELECT
           count(DISTINCT sv.source_id) AS version_count,
           count(sr.id) AS record_count
         FROM source_versions sv
         LEFT JOIN source_records sr ON sr.source_id = sv.source_id
         WHERE sv.series_id = ?`,
      )
      .get(series.id) as { version_count: number; record_count: number };
    const blockers: string[] = [];
    if (series.is_deleted !== 1) {
      blockers.push("The source series must be deleted before purge.");
    }
    if (dependentMemoryIds.length > 0) {
      blockers.push("Retained memories still depend on this source series.");
    }
    if (activeReviewPolicyIds.length > 0) {
      blockers.push("Active review policies still trust this source identity.");
    }
    return {
      seriesId: series.id,
      kind: input.kind,
      externalId,
      isDeleted: series.is_deleted === 1,
      versionCount: counts.version_count,
      recordCount: counts.record_count,
      dependentMemoryIds,
      dependentCandidateIds,
      activeReviewPolicyIds,
      blockers,
      canPurge: blockers.length === 0,
      externalCopiesNotModified: true,
    };
  }

  public purgeSourceSeries(
    input: SourceSeriesIdentity & { reason: string },
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): SourceSeriesPurgeReceipt {
    this.requireExplicitSourceAction(actor, explicitUserAction, "purge");
    const externalId = validateText(input.externalId, "A source external ID");
    const reason = validateText(input.reason, "A source purge reason");
    const identity = { kind: input.kind, externalId };
    const preview = this.previewSourceSeriesPurge(identity);
    if (!preview.canPurge) {
      throw new Error(`Source series cannot be purged: ${preview.blockers.join(" ")}`);
    }
    const receiptId = randomUUID();
    const purgedAt = new Date().toISOString();
    let deletedRowCounts: Record<string, number> = {};
    const purgeTransaction = this.database.transaction(() => {
      const current = this.previewSourceSeriesPurge(identity);
      if (!current.canPurge) {
        throw new Error(`Source series cannot be purged: ${current.blockers.join(" ")}`);
      }
      const candidateIds = current.dependentCandidateIds;
      const sourceRows = this.database
        .prepare("SELECT source_id AS id FROM source_versions WHERE series_id = ?")
        .all(current.seriesId) as Array<{ id: string }>;
      const countCandidateRows = (table: string): number => {
        if (candidateIds.length === 0) {
          return 0;
        }
        const marks = candidateIds.map(() => "?").join(", ");
        return (
          this.database
            .prepare(
              `SELECT count(*) AS count FROM ${table} WHERE candidate_id IN (${marks})`,
            )
            .get(...candidateIds) as { count: number }
        ).count;
      };
      const countDeletionTrackingRows = (table: string): number =>
        (
          this.database
            .prepare(
              `SELECT count(*) AS count
               FROM ${table} tracked
               JOIN source_series_deletion_events event
                 ON event.id = tracked.deletion_event_id
               WHERE event.series_id = ?`,
            )
            .get(current.seriesId) as { count: number }
        ).count;
      deletedRowCounts = {
        sourceSeries: 1,
        sourceVersions: sourceRows.length,
        sources: sourceRows.length,
        sourceRecords: current.recordCount,
        sourceDeletionEvents: (
          this.database
            .prepare(
              "SELECT count(*) AS count FROM source_series_deletion_events WHERE series_id = ?",
            )
            .get(current.seriesId) as { count: number }
        ).count,
        sourceDeletionSources: countDeletionTrackingRows(
          "source_series_deletion_sources",
        ),
        sourceDeletionRecords: countDeletionTrackingRows(
          "source_series_deletion_records",
        ),
        memoryCandidates: candidateIds.length,
        ambientCandidateProfiles: countCandidateRows("ambient_candidate_profiles"),
        candidateEvidence: countCandidateRows("candidate_evidence"),
        candidateEvents: countCandidateRows("candidate_events"),
        candidateResolutions: countCandidateRows("candidate_resolutions"),
      };
      for (const candidateId of candidateIds) {
        this.database.prepare("DELETE FROM memory_candidates WHERE id = ?").run(candidateId);
      }
      this.database
        .prepare("DELETE FROM source_versions WHERE series_id = ?")
        .run(current.seriesId);
      this.database.prepare("DELETE FROM source_series WHERE id = ?").run(current.seriesId);
      for (const source of sourceRows) {
        this.database.prepare("DELETE FROM sources WHERE id = ?").run(source.id);
      }
      this.database
        .prepare(
          `INSERT INTO source_purge_receipts (
             id, source_kind, external_id, reason, actor_type,
             deleted_row_counts_json, purged_at
           ) VALUES (?, ?, ?, ?, 'user', ?, ?)`,
        )
        .run(
          receiptId,
          input.kind,
          externalId,
          reason,
          JSON.stringify(deletedRowCounts),
          purgedAt,
        );
    });
    purgeTransaction();
    return {
      receiptId,
      kind: input.kind,
      externalId,
      purgedAt,
      deletedRowCounts,
      externalCopiesNotModified: true,
    };
  }

  public getSourceRecord(id: string): SourceRecord | null {
    const row = this.database
      .prepare(
        `SELECT
           id, source_id, ordinal, record_kind, author_role, author_name,
           content, content_hash, occurred_at, metadata_json, created_at
         FROM source_records
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as SourceRecordRow | undefined;
    return row === undefined ? null : mapSourceRecord(row);
  }

  public getSourceRecords(sourceId: string): SourceRecord[] {
    this.requireSource(sourceId);
    const rows = this.database
      .prepare(
        `SELECT
           id, source_id, ordinal, record_kind, author_role, author_name,
           content, content_hash, occurred_at, metadata_json, created_at
         FROM source_records
         WHERE source_id = ? AND deleted_at IS NULL
         ORDER BY ordinal ASC, id`,
      )
      .all(sourceId) as SourceRecordRow[];
    return rows.map(mapSourceRecord);
  }

  public proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate {
    const assertion = validateText(input.assertion, "A candidate assertion");
    const confidence = validateConfidence(input.confidence ?? 1);
    const externalId = input.externalId?.trim();
    if (externalId !== undefined && externalId.length === 0) {
      throw new Error("A candidate external ID cannot be empty.");
    }
    if (input.evidence.length === 0) {
      throw new Error("A memory candidate requires at least one evidence record.");
    }
    if (
      input.ambientContext !== undefined &&
      !personaMemoryClasses.includes(input.ambientContext.memoryClass)
    ) {
      throw new Error(
        `Unsupported persona memory class: ${input.ambientContext.memoryClass}.`,
      );
    }

    const evidenceKeys = new Set<string>();
    for (const evidence of input.evidence) {
      const key = `${evidence.sourceRecordId}\u0000${evidence.role ?? "supports"}`;
      if (evidenceKeys.has(key)) {
        throw new Error("Candidate evidence entries must be unique by source record and role.");
      }
      evidenceKeys.add(key);
    }

    if (externalId !== undefined) {
      const existing = this.getCandidateByExternalId(externalId);
      if (existing !== null) {
        if (
          !this.candidateMatchesInput(existing, input, assertion, confidence) ||
          !this.ambientContextMatchesInput(existing.id, input)
        ) {
          throw new Error(
            `Candidate external ID ${externalId} already exists with different content. Use a new external ID to preserve provenance.`,
          );
        }
        return existing;
      }
    }

    const id = randomUUID();
    const actor = input.proposedBy ?? "system";
    const proposeTransaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO memory_candidates (
             id, external_id, memory_type, assertion, normalized_assertion, explicitness,
             confidence, observed_at, retrieval_policy, sensitivity,
             is_pinned, is_protected, scope_id, proposed_by, proposer_id,
             metadata_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          externalId ?? null,
          input.type,
          assertion,
          input.normalizedAssertion ?? null,
          input.explicitness ?? "explicit",
          confidence,
          input.observedAt ?? null,
          input.retrievalPolicy ?? "include",
          input.sensitivity ?? "normal",
          input.isPinned === true ? 1 : 0,
          input.isProtected === true ? 1 : 0,
          input.scopeId,
          actor,
          input.proposerId ?? null,
          JSON.stringify(input.metadata ?? {}),
        );

      const insertEvidence = this.database.prepare(
        `INSERT INTO candidate_evidence (
           candidate_id, source_record_id, evidence_role, excerpt
         ) VALUES (?, ?, ?, ?)`,
      );
      for (const evidence of input.evidence) {
        insertEvidence.run(
          id,
          evidence.sourceRecordId,
          evidence.role ?? "supports",
          evidence.excerpt ?? null,
        );
      }
      if (input.ambientContext !== undefined) {
        const context = input.ambientContext;
        this.database
          .prepare(
            `INSERT INTO ambient_candidate_profiles (
               candidate_id, source_id, user_id, persona_id, relationship_id,
               memory_class, extractor_id, extractor_version,
               sensitivity_assessment_status, declared_sensitivity,
               assessed_sensitivity, sensitivity_confidence,
               sensitivity_classifier_id, sensitivity_classifier_version,
               sensitivity_reason_codes_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            context.sourceId,
            context.userId,
            context.personaId,
            context.relationshipId,
            context.memoryClass,
            context.extractorId,
            context.extractorVersion,
            context.sensitivityAssessment.status,
            context.sensitivityAssessment.declaredSensitivity,
            context.sensitivityAssessment.assessedSensitivity,
            context.sensitivityAssessment.confidence,
            context.sensitivityAssessment.classifierId,
            context.sensitivityAssessment.classifierVersion,
            JSON.stringify(context.sensitivityAssessment.reasonCodes),
          );
      }
      this.writeCandidateEvent(id, "proposed", actor);
    });

    proposeTransaction();
    return this.requireCandidate(id);
  }

  private ambientContextMatchesInput(
    candidateId: string,
    input: ProposeMemoryCandidateInput,
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT
           source_id, user_id, persona_id, relationship_id, memory_class,
           extractor_id, extractor_version, sensitivity_assessment_status,
           declared_sensitivity, assessed_sensitivity, sensitivity_confidence,
           sensitivity_classifier_id, sensitivity_classifier_version,
           sensitivity_reason_codes_json
         FROM ambient_candidate_profiles
         WHERE candidate_id = ?`,
      )
      .get(candidateId) as
      | {
          source_id: string;
          user_id: string;
          persona_id: string;
          relationship_id: string;
          memory_class: string;
          extractor_id: string;
          extractor_version: string;
          sensitivity_assessment_status: string;
          declared_sensitivity: Sensitivity | null;
          assessed_sensitivity: Sensitivity;
          sensitivity_confidence: number;
          sensitivity_classifier_id: string;
          sensitivity_classifier_version: string;
          sensitivity_reason_codes_json: string;
        }
      | undefined;
    const context = input.ambientContext;
    if (context === undefined) {
      return row === undefined;
    }
    return (
      row !== undefined &&
      row.source_id === context.sourceId &&
      row.user_id === context.userId &&
      row.persona_id === context.personaId &&
      row.relationship_id === context.relationshipId &&
      row.memory_class === context.memoryClass &&
      row.extractor_id === context.extractorId &&
      row.extractor_version === context.extractorVersion &&
      row.sensitivity_assessment_status === context.sensitivityAssessment.status &&
      row.declared_sensitivity ===
        context.sensitivityAssessment.declaredSensitivity &&
      row.assessed_sensitivity ===
        context.sensitivityAssessment.assessedSensitivity &&
      row.sensitivity_confidence === context.sensitivityAssessment.confidence &&
      row.sensitivity_classifier_id ===
        context.sensitivityAssessment.classifierId &&
      row.sensitivity_classifier_version ===
        context.sensitivityAssessment.classifierVersion &&
      canonicalJson(JSON.parse(row.sensitivity_reason_codes_json)) ===
        canonicalJson(context.sensitivityAssessment.reasonCodes)
    );
  }

  public getCandidate(id: string): MemoryCandidate | null {
    const row = this.database
      .prepare("SELECT * FROM memory_candidates WHERE id = ?")
      .get(id) as CandidateRow | undefined;
    return row === undefined ? null : this.mapCandidate(row);
  }

  public getCandidateByExternalId(externalId: string): MemoryCandidate | null {
    const normalized = validateText(externalId, "A candidate external ID");
    const row = this.database
      .prepare("SELECT * FROM memory_candidates WHERE external_id = ?")
      .get(normalized) as CandidateRow | undefined;
    return row === undefined ? null : this.mapCandidate(row);
  }

  public listCandidates(
    status?: CandidateStatus,
    limit = 100,
  ): MemoryCandidate[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = (
      status === undefined
        ? this.database.prepare(
            `SELECT * FROM memory_candidates
             ORDER BY created_at DESC, id LIMIT ?`,
          ).all(safeLimit)
        : this.database.prepare(
            `SELECT * FROM memory_candidates WHERE status = ?
             ORDER BY created_at ASC, id LIMIT ?`,
          ).all(status, safeLimit)
    ) as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  public findCandidateMatches(id: string, limit = 20): CandidateMatch[] {
    const candidate = this.requireCandidate(id);
    const matchKey = normalizeForExactMatch(
      candidate.normalizedAssertion ?? candidate.assertion,
    );
    if (matchKey.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT m.id
         FROM memory_items m
         JOIN memory_revisions r ON r.id = m.current_revision_id
         WHERE m.status = 'active'
           AND m.memory_type = ?
           AND EXISTS (
             SELECT 1 FROM memory_scopes ms
             WHERE ms.memory_id = m.id AND ms.scope_id = ?
           )
         ORDER BY m.updated_at DESC, m.id
         LIMIT 100`,
      )
      .all(candidate.type, candidate.scopeId) as Array<{ id: string }>;

    const matches: CandidateMatch[] = [];
    for (const row of rows) {
      const memory = this.memoryRepository.getById(row.id);
      if (
        memory !== null &&
        normalizeForExactMatch(memory.normalizedAssertion ?? memory.assertion) ===
          matchKey
      ) {
        matches.push({
          memory,
          matchKind: "exact_normalized",
          score: 1,
          reason: "The candidate and active memory have the same normalized assertion.",
          matcherId: "memtextual.exact-normalized",
          matcherVersion: "1",
        });
      }
      if (matches.length >= safeLimit) {
        break;
      }
    }
    return matches;
  }

  public listCandidateMatchTargets(id: string, limit = 100) {
    const candidate = this.requireCandidate(id);
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = this.database
      .prepare(
        `SELECT m.id
         FROM memory_items m
         WHERE m.status = 'active'
           AND m.memory_type = ?
           AND EXISTS (
             SELECT 1 FROM memory_scopes ms
             WHERE ms.memory_id = m.id AND ms.scope_id = ?
           )
         ORDER BY m.updated_at DESC, m.id
         LIMIT ?`,
      )
      .all(candidate.type, candidate.scopeId, safeLimit) as Array<{ id: string }>;
    return rows.flatMap(({ id: memoryId }) => {
      const memory = this.memoryRepository.getById(memoryId);
      return memory === null ? [] : [memory];
    });
  }

  public getCandidateResolution(id: string): CandidateResolution | null {
    const row = this.database
      .prepare("SELECT * FROM candidate_resolutions WHERE candidate_id = ?")
      .get(id) as CandidateResolutionRow | undefined;
    return row === undefined ? null : this.mapResolution(row);
  }

  public resolveCandidate(
    id: string,
    resolution: CandidateResolutionInput,
    actor: CandidateActor,
    note?: string,
  ): CandidateResolutionResult {
    this.requireReviewActor(id, actor);
    if (!candidateResolutionKinds.includes(resolution.outcome)) {
      throw new Error(`Unsupported candidate resolution: ${String(resolution.outcome)}`);
    }
    if (resolution.outcome === "create") {
      const acceptance = this.acceptCandidate(id, actor, note);
      return {
        candidate: acceptance.candidate,
        resolution: this.requireResolution(id),
        memory: acceptance.memory,
        targetMemory: null,
      };
    }
    if (resolution.outcome === "ignore") {
      const candidate = this.rejectCandidate(id, actor, note);
      return {
        candidate,
        resolution: this.requireResolution(id),
        memory: null,
        targetMemory: null,
      };
    }

    const targetMemoryId = resolution.targetMemoryId?.trim();
    if (targetMemoryId === undefined || targetMemoryId.length === 0) {
      throw new Error(`${resolution.outcome} requires a target memory ID.`);
    }

    let resultMemoryId = "";
    const resolveTransaction = this.database.transaction(() => {
      const candidate = this.requirePendingCandidate(id);
      const target = this.requireResolutionTarget(candidate, targetMemoryId);
      let result;

      if (resolution.outcome === "revise") {
        result = this.memoryRepository.revise(
          target.id,
          {
            assertion: candidate.assertion,
            normalizedAssertion: candidate.normalizedAssertion,
            explicitness: candidate.explicitness,
            confidence: candidate.confidence,
            observedAt: candidate.observedAt,
            changeKind: "corrected",
          },
          "user",
          true,
        );
        this.copyCandidateEvidence(candidate, result.revisionId);
      } else if (resolution.outcome === "reaffirm") {
        result = this.memoryRepository.revise(
          target.id,
          {
            assertion: target.assertion,
            normalizedAssertion: target.normalizedAssertion,
            explicitness: target.explicitness,
            confidence: Math.max(target.confidence, candidate.confidence),
            observedAt: candidate.observedAt,
            changeKind: "reaffirmed",
          },
          "user",
          true,
        );
        this.copyCandidateEvidence(candidate, result.revisionId);
      } else {
        result = this.createMemoryFromCandidate(candidate, "user");
        if (resolution.outcome === "contradict") {
          this.memoryRepository.contradict(target.id, result.id, "user", true);
        } else {
          this.memoryRepository.supersede(target.id, result.id, "user", true);
        }
      }

      resultMemoryId = result.id;
      this.completeCandidateReview(
        candidate.id,
        "accepted",
        actor,
        note,
        result.id,
      );
      this.insertResolution(
        candidate.id,
        resolution.outcome,
        target.id,
        result.id,
        actor,
        note,
      );
      this.writeCandidateEvent(id, "accepted", actor, {
        memoryId: result.id,
        targetMemoryId: target.id,
        resolution: resolution.outcome,
        reviewMethod: "manual",
      });
    });

    resolveTransaction();
    const memory = this.memoryRepository.getById(resultMemoryId);
    const targetMemory = this.memoryRepository.getById(targetMemoryId);
    if (memory === null || targetMemory === null) {
      throw new Error("The candidate was resolved but its memories could not be read back.");
    }
    return {
      candidate: this.requireCandidate(id),
      resolution: this.requireResolution(id),
      memory,
      targetMemory,
    };
  }

  public acceptCandidate(
    id: string,
    actor: CandidateActor,
    note?: string,
    policyAuthorization?: PolicyAcceptanceAuthorization,
  ): CandidateAcceptance {
    this.requireReviewActor(id, actor, policyAuthorization);
    let memoryId = "";

    const acceptTransaction = this.database.transaction(() => {
      const candidate = this.requirePendingCandidate(id);
      const memory = this.memoryRepository.create({
        assertion: candidate.assertion,
        type: candidate.type,
        scopeId: candidate.scopeId,
        ...(candidate.normalizedAssertion === null
          ? {}
          : { normalizedAssertion: candidate.normalizedAssertion }),
        explicitness: candidate.explicitness,
        confidence: candidate.confidence,
        ...(candidate.observedAt === null
          ? {}
          : { observedAt: candidate.observedAt }),
        createdBy: actor === "user" ? "user" : "system",
        retrievalPolicy: candidate.retrievalPolicy,
        sensitivity: candidate.sensitivity,
        isPinned: candidate.isPinned,
        isProtected: candidate.isProtected,
      });
      memoryId = memory.id;

      const insertEvidence = this.database.prepare(
        `INSERT INTO memory_evidence (
           memory_revision_id, source_record_id, evidence_role, excerpt
         ) VALUES (?, ?, ?, ?)`,
      );
      for (const evidence of candidate.evidence) {
        insertEvidence.run(
          memory.revisionId,
          evidence.sourceRecordId,
          evidence.role,
          evidence.excerpt,
        );
      }

      this.insertResolution(
        id,
        "create",
        null,
        memory.id,
        actor,
        note,
      );

      this.database
        .prepare(
          `UPDATE memory_candidates
           SET status = 'accepted', reviewed_by = ?,
               reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               review_note = ?, accepted_memory_id = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(actor, this.normalizeNote(note), memory.id, id);
      this.writeCandidateEvent(id, "accepted", actor, {
        memoryId: memory.id,
        reviewMethod: actor === "user" ? "manual" : "automatic",
        ...(policyAuthorization === undefined
          ? {}
          : {
              policyId: policyAuthorization.policyId,
              policyVersion: policyAuthorization.policyVersion,
              evaluation: policyAuthorization.evaluation,
            }),
      });
    });

    acceptTransaction();
    const memory = this.memoryRepository.getById(memoryId);
    if (memory === null) {
      throw new Error("The candidate was accepted but its memory could not be read back.");
    }
    return { candidate: this.requireCandidate(id), memory };
  }

  public rejectCandidate(
    id: string,
    actor: CandidateActor,
    note?: string,
  ): MemoryCandidate {
    this.requireReviewActor(id, actor);
    const rejectTransaction = this.database.transaction(() => {
      this.requirePendingCandidate(id);
      this.insertResolution(id, "ignore", null, null, actor, note);
      this.database
        .prepare(
          `UPDATE memory_candidates
           SET status = 'rejected', reviewed_by = ?,
               reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               review_note = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(actor, this.normalizeNote(note), id);
      this.writeCandidateEvent(id, "rejected", actor);
    });
    rejectTransaction();
    return this.requireCandidate(id);
  }

  private insertSource(
    sourceId: string,
    storedExternalId: string | null,
    title: string,
    contentHash: string,
    input: ImportSourceInput,
  ): void {
    this.database
      .prepare(
        `INSERT INTO sources (
           id, source_kind, title, origin_uri, external_id, content_hash,
           captured_at, metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceId,
        input.kind,
        title,
        input.originUri ?? null,
        storedExternalId,
        contentHash,
        input.capturedAt ?? null,
        JSON.stringify(input.metadata ?? {}),
      );

    const insertRecord = this.database.prepare(
      `INSERT INTO source_records (
         id, source_id, ordinal, record_kind, author_role, author_name,
         content, content_hash, occurred_at, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [ordinal, record] of input.records.entries()) {
      insertRecord.run(
        randomUUID(),
        sourceId,
        ordinal,
        record.kind,
        record.authorRole ?? null,
        record.authorName ?? null,
        record.content,
        sha256(record.content),
        record.occurredAt ?? null,
        JSON.stringify(record.metadata ?? {}),
      );
    }
  }

  private requireExplicitSourceAction(
    actor: CandidateActor,
    explicitUserAction: boolean,
    operation: string,
  ): void {
    if (actor !== "user" || !explicitUserAction) {
      throw new Error(
        `An explicit user action is required to ${operation} a source series.`,
      );
    }
  }

  private requireSourceSeries(
    input: SourceSeriesIdentity,
  ): SourceSeriesLifecycleRow {
    const row = this.database
      .prepare(
        `SELECT ss.id,
                CASE WHEN s.deleted_at IS NOT NULL AND EXISTS (
                  SELECT 1 FROM source_series_deletion_events sde
                  WHERE sde.series_id = ss.id AND sde.restored_at IS NULL
                ) THEN 1 ELSE 0 END AS is_deleted
         FROM source_series ss
         JOIN sources s ON s.id = ss.current_source_id
         WHERE ss.source_kind = ? AND ss.external_id = ?`,
      )
      .get(input.kind, input.externalId) as SourceSeriesLifecycleRow | undefined;
    if (row === undefined) {
      throw new Error(`Source series not found: ${input.kind}:${input.externalId}`);
    }
    return row;
  }

  private createSourceVersion(
    input: ImportSourceInput,
    title: string,
    externalId: string,
    contentHash: string,
    existing: Source,
    versionReason: string | undefined,
  ): SourceImportResult {
    if (existing.seriesId === null || existing.versionNumber === null) {
      throw new Error(
        `Source ${input.kind}:${externalId} has no version series and cannot be versioned safely.`,
      );
    }

    const series = this.database
      .prepare(
        `SELECT ss.id, ss.current_source_id,
                COALESCE(max(sv.version_number), 0) + 1 AS next_version
         FROM source_series ss
         JOIN source_versions sv ON sv.series_id = ss.id
         WHERE ss.id = ?
         GROUP BY ss.id`,
      )
      .get(existing.seriesId) as SourceSeriesRow | undefined;
    if (series === undefined || series.current_source_id !== existing.id) {
      throw new Error("The source version series changed before the import completed.");
    }

    const sourceId = randomUUID();
    const storedExternalId = `memtextual-version:${series.id}:${series.next_version}`;
    const versionTransaction = this.database.transaction(() => {
      this.insertSource(sourceId, storedExternalId, title, contentHash, input);
      this.database
        .prepare(
          `INSERT INTO source_versions (
             source_id, series_id, version_number, previous_source_id,
             version_reason
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          sourceId,
          series.id,
          series.next_version,
          existing.id,
          versionReason ?? null,
        );
      const updated = this.database
        .prepare(
          `UPDATE source_series
           SET current_source_id = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND current_source_id = ?`,
        )
        .run(sourceId, series.id, existing.id);
      if (updated.changes !== 1) {
        throw new Error("The source version series changed during the import.");
      }
    });
    versionTransaction();
    return {
      source: this.requireSource(sourceId),
      records: this.getSourceRecords(sourceId),
      created: true,
    };
  }

  private sourceSelect(): string {
    return `SELECT
      s.id, s.source_kind, s.title, s.origin_uri,
      COALESCE(ss.external_id, s.external_id) AS external_id,
      s.content_hash, s.captured_at, s.metadata_json, s.created_at, s.deleted_at,
      (SELECT count(*) FROM source_records r
       WHERE r.source_id = s.id AND r.deleted_at IS NULL) AS record_count,
      sv.series_id, sv.version_number, sv.previous_source_id, sv.version_reason,
      (SELECT sde.reason FROM source_series_deletion_events sde
       WHERE sde.series_id = sv.series_id AND sde.restored_at IS NULL) AS deletion_reason,
      CASE WHEN sv.source_id IS NULL OR ss.current_source_id = s.id THEN 1 ELSE 0 END AS is_current
      FROM sources s
      LEFT JOIN source_versions sv ON sv.source_id = s.id
      LEFT JOIN source_series ss ON ss.id = sv.series_id`;
  }

  private findSourceByExternalId(kind: SourceKind, externalId: string): Source | null {
    const row = this.database
      .prepare(
        `${this.sourceSelect()}
         WHERE ss.source_kind = ? AND ss.external_id = ?
           AND ss.current_source_id = s.id`,
      )
      .get(kind, externalId) as SourceRow | undefined;
    return row === undefined ? null : mapSource(row);
  }

  private findSourceByHash(kind: SourceKind, contentHash: string): Source | null {
    const row = this.database
      .prepare(
        `${this.sourceSelect()}
         WHERE s.source_kind = ? AND s.content_hash = ?
           AND s.external_id IS NULL AND s.deleted_at IS NULL`,
      )
      .get(kind, contentHash) as SourceRow | undefined;
    return row === undefined ? null : mapSource(row);
  }

  private requireSource(id: string): Source {
    const row = this.database
      .prepare(`${this.sourceSelect()} WHERE s.id = ?`)
      .get(id) as SourceRow | undefined;
    if (row === undefined) {
      throw new Error(`Source not found: ${id}`);
    }
    return mapSource(row);
  }

  private mapCandidate(row: CandidateRow): MemoryCandidate {
    const evidenceRows = this.database
      .prepare(
        `SELECT source_record_id, evidence_role, excerpt
         FROM candidate_evidence
         WHERE candidate_id = ?
         ORDER BY created_at, source_record_id, evidence_role`,
      )
      .all(row.id) as CandidateEvidenceRow[];
    return {
      id: row.id,
      externalId: row.external_id,
      status: row.status,
      assertion: row.assertion,
      type: row.memory_type,
      scopeId: row.scope_id,
      evidence: evidenceRows.map((evidence) => ({
        sourceRecordId: evidence.source_record_id,
        role: evidence.evidence_role,
        excerpt: evidence.excerpt,
      })),
      normalizedAssertion: row.normalized_assertion,
      explicitness: row.explicitness,
      confidence: row.confidence,
      observedAt: row.observed_at,
      retrievalPolicy: row.retrieval_policy,
      sensitivity: row.sensitivity,
      isPinned: row.is_pinned === 1,
      isProtected: row.is_protected === 1,
      proposedBy: row.proposed_by,
      proposerId: row.proposer_id,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      acceptedMemoryId: row.accepted_memory_id,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapResolution(row: CandidateResolutionRow): CandidateResolution {
    return {
      candidateId: row.candidate_id,
      outcome: row.outcome,
      targetMemoryId: row.target_memory_id,
      resultMemoryId: row.result_memory_id,
      actor: row.actor_type,
      note: row.note,
      resolvedAt: row.resolved_at,
    };
  }

  private requireResolution(id: string): CandidateResolution {
    const resolution = this.getCandidateResolution(id);
    if (resolution === null) {
      throw new Error(`Candidate resolution not found: ${id}`);
    }
    return resolution;
  }

  private requireResolutionTarget(
    candidate: MemoryCandidate,
    targetMemoryId: string,
  ) {
    const target = this.memoryRepository.getById(targetMemoryId);
    if (target === null) {
      throw new Error(`Target memory not found: ${targetMemoryId}`);
    }
    if (target.status !== "active") {
      throw new Error(
        `Cannot resolve against memory ${target.id} while its status is ${target.status}.`,
      );
    }
    if (target.type !== candidate.type) {
      throw new Error("Candidate and target memory types must match.");
    }
    if (!target.scopes.some(({ id }) => id === candidate.scopeId)) {
      throw new Error("Candidate and target memory must share the candidate scope.");
    }
    return target;
  }

  private createMemoryFromCandidate(
    candidate: MemoryCandidate,
    actor: CandidateActor,
  ) {
    const memory = this.memoryRepository.create({
      assertion: candidate.assertion,
      type: candidate.type,
      scopeId: candidate.scopeId,
      ...(candidate.normalizedAssertion === null
        ? {}
        : { normalizedAssertion: candidate.normalizedAssertion }),
      explicitness: candidate.explicitness,
      confidence: candidate.confidence,
      ...(candidate.observedAt === null ? {} : { observedAt: candidate.observedAt }),
      createdBy: actor === "user" ? "user" : "system",
      retrievalPolicy: candidate.retrievalPolicy,
      sensitivity: candidate.sensitivity,
      isPinned: candidate.isPinned,
      isProtected: candidate.isProtected,
    });
    this.copyCandidateEvidence(candidate, memory.revisionId);
    return memory;
  }

  private copyCandidateEvidence(
    candidate: MemoryCandidate,
    revisionId: string,
  ): void {
    const insertEvidence = this.database.prepare(
      `INSERT INTO memory_evidence (
         memory_revision_id, source_record_id, evidence_role, excerpt
       ) VALUES (?, ?, ?, ?)`,
    );
    for (const evidence of candidate.evidence) {
      insertEvidence.run(
        revisionId,
        evidence.sourceRecordId,
        evidence.role,
        evidence.excerpt,
      );
    }
  }

  private completeCandidateReview(
    id: string,
    status: "accepted" | "rejected",
    actor: CandidateActor,
    note: string | undefined,
    acceptedMemoryId: string | null,
  ): void {
    this.database
      .prepare(
        `UPDATE memory_candidates
         SET status = ?, reviewed_by = ?,
             reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             review_note = ?, accepted_memory_id = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .run(
        status,
        actor,
        this.normalizeNote(note),
        acceptedMemoryId,
        id,
      );
  }

  private insertResolution(
    candidateId: string,
    outcome: CandidateResolutionKind,
    targetMemoryId: string | null,
    resultMemoryId: string | null,
    actor: CandidateActor,
    note?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO candidate_resolutions (
           candidate_id, outcome, target_memory_id, result_memory_id,
           actor_type, note
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        outcome,
        targetMemoryId,
        resultMemoryId,
        actor,
        this.normalizeNote(note),
      );
  }

  private candidateMatchesInput(
    candidate: MemoryCandidate,
    input: ProposeMemoryCandidateInput,
    assertion: string,
    confidence: number,
  ): boolean {
    const evidence = input.evidence
      .map((item) => ({
        sourceRecordId: item.sourceRecordId,
        role: item.role ?? "supports",
        excerpt: item.excerpt ?? null,
      }))
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
    const existingEvidence = [...candidate.evidence].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
    return canonicalJson({
      assertion: candidate.assertion,
      type: candidate.type,
      scopeId: candidate.scopeId,
      evidence: existingEvidence,
      normalizedAssertion: candidate.normalizedAssertion,
      explicitness: candidate.explicitness,
      confidence: candidate.confidence,
      observedAt: candidate.observedAt,
      retrievalPolicy: candidate.retrievalPolicy,
      sensitivity: candidate.sensitivity,
      isPinned: candidate.isPinned,
      isProtected: candidate.isProtected,
      proposedBy: candidate.proposedBy,
      proposerId: candidate.proposerId,
      metadata: candidate.metadata,
    }) === canonicalJson({
      assertion,
      type: input.type,
      scopeId: input.scopeId,
      evidence,
      normalizedAssertion: input.normalizedAssertion ?? null,
      explicitness: input.explicitness ?? "explicit",
      confidence,
      observedAt: input.observedAt ?? null,
      retrievalPolicy: input.retrievalPolicy ?? "include",
      sensitivity: input.sensitivity ?? "normal",
      isPinned: input.isPinned === true,
      isProtected: input.isProtected === true,
      proposedBy: input.proposedBy ?? "system",
      proposerId: input.proposerId ?? null,
      metadata: input.metadata ?? {},
    });
  }

  private requireCandidate(id: string): MemoryCandidate {
    const candidate = this.getCandidate(id);
    if (candidate === null) {
      throw new Error(`Memory candidate not found: ${id}`);
    }
    return candidate;
  }

  private requirePendingCandidate(id: string): MemoryCandidate {
    const candidate = this.requireCandidate(id);
    if (candidate.status !== "pending") {
      throw new Error(
        `Cannot review candidate ${id} while its status is ${candidate.status}.`,
      );
    }
    return candidate;
  }

  private requireReviewActor(
    candidateId: string,
    actor: CandidateActor,
    policyAuthorization?: PolicyAcceptanceAuthorization,
  ): void {
    if (actor === "user") {
      return;
    }
    if (actor !== "system" || policyAuthorization === undefined) {
      throw new Error(
        "Candidate review requires the user actor or a policy-authorized system acceptance.",
      );
    }
    if (policyAuthorization.evaluation.outcome !== "automatic_accept") {
      throw new Error("The supplied policy evaluation does not authorize acceptance.");
    }
    if (
      policyAuthorization.evaluation.candidateId !== candidateId ||
      policyAuthorization.evaluation.policy?.id !== policyAuthorization.policyId ||
      policyAuthorization.evaluation.policy.version !==
        policyAuthorization.policyVersion
    ) {
      throw new Error("The policy authorization does not match this candidate.");
    }
    const policy = this.database
      .prepare(
        `WITH RECURSIVE candidate_scope(id, depth) AS (
           SELECT scope_id, 0 FROM memory_candidates WHERE id = ?
           UNION ALL
           SELECT s.parent_scope_id, candidate_scope.depth + 1
           FROM scopes s
           JOIN candidate_scope ON s.id = candidate_scope.id
           WHERE s.parent_scope_id IS NOT NULL
         ), effective_policy AS (
           SELECT p.id, p.version
           FROM review_policies p
           LEFT JOIN candidate_scope ON p.scope_id = candidate_scope.id
           WHERE p.is_active = 1
             AND (p.scope_id IS NULL OR candidate_scope.id IS NOT NULL)
           ORDER BY
             CASE WHEN p.scope_id IS NULL THEN 1 ELSE 0 END,
             candidate_scope.depth ASC
           LIMIT 1
         )
         SELECT id FROM effective_policy
         WHERE id = ? AND version = ?`,
      )
      .get(
        candidateId,
        policyAuthorization.policyId,
        policyAuthorization.policyVersion,
      ) as { id: string } | undefined;
    if (policy === undefined) {
      throw new Error("The authorizing review policy is not active.");
    }
  }

  private normalizeNote(note?: string): string | null {
    const normalized = note?.trim();
    return normalized === undefined || normalized.length === 0 ? null : normalized;
  }

  private writeCandidateEvent(
    candidateId: string,
    eventType: "proposed" | "accepted" | "rejected",
    actor: CandidateActor,
    detail: Record<string, unknown> = {},
  ): void {
    this.database
      .prepare(
        `INSERT INTO candidate_events (
           id, candidate_id, event_type, actor_type, detail_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), candidateId, eventType, actor, JSON.stringify(detail));
  }
}
