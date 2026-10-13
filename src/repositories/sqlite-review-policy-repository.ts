import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  CandidateEvidenceFact,
  CandidatePolicyFacts,
  ReviewPolicy,
  ReviewPolicyConditions,
  ReviewPolicyMode,
  SetReviewPolicyInput,
  TrustedSourceIdentity,
} from "../domain/review-policy.js";
import type { SourceKind } from "../domain/ingestion.js";
import type { IngestionRepository } from "./ingestion-repository.js";
import type { ReviewPolicyRepository } from "./review-policy-repository.js";

interface ReviewPolicyRow {
  id: string;
  scope_id: string | null;
  name: string;
  version: number;
  mode: ReviewPolicyMode;
  conditions_json: string;
  is_active: 0 | 1;
  created_by: "user";
  created_at: string;
  deactivated_at: string | null;
}

interface EvidenceFactRow {
  source_record_id: string;
  evidence_role: CandidateEvidenceFact["role"];
  excerpt: string | null;
  source_id: string;
  source_kind: SourceKind;
  external_id: string | null;
  author_role: string | null;
  content: string;
}

function mapPolicy(row: ReviewPolicyRow): ReviewPolicy {
  return {
    id: row.id,
    scopeId: row.scope_id,
    name: row.name,
    version: row.version,
    mode: row.mode,
    conditions: JSON.parse(row.conditions_json) as ReviewPolicyConditions,
    isActive: row.is_active === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  };
}

export class SqliteReviewPolicyRepository implements ReviewPolicyRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly ingestionRepository: IngestionRepository,
  ) {}

  public setPolicy(input: SetReviewPolicyInput): ReviewPolicy {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error("A review policy name cannot be empty.");
    }

    const policyId = randomUUID();
    const setTransaction = this.database.transaction(() => {
      const current = this.database
        .prepare(
          `SELECT id FROM review_policies
           WHERE scope_id IS ? AND is_active = 1`,
        )
        .get(input.scopeId ?? null) as { id: string } | undefined;

      if (current !== undefined) {
        this.database
          .prepare(
            `UPDATE review_policies
             SET is_active = 0,
                 deactivated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?`,
          )
          .run(current.id);
        this.writeEvent(current.id, "deactivated", { replacementPolicyId: policyId });
      }

      const versionRow = this.database
        .prepare(
          `SELECT COALESCE(max(version), 0) + 1 AS version
           FROM review_policies WHERE scope_id IS ?`,
        )
        .get(input.scopeId ?? null) as { version: number };

      this.database
        .prepare(
          `INSERT INTO review_policies (
             id, scope_id, name, version, mode, conditions_json,
             is_active, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, 1, 'user')`,
        )
        .run(
          policyId,
          input.scopeId ?? null,
          name,
          versionRow.version,
          input.mode,
          JSON.stringify(input.conditions ?? {}),
        );
      this.writeEvent(policyId, "created", { mode: input.mode });
      this.writeEvent(policyId, "activated");
    });

    setTransaction();
    return this.requirePolicy(policyId);
  }

  public getEffectivePolicy(scopeId: string): ReviewPolicy | null {
    const row = this.database
      .prepare(
        `WITH RECURSIVE scope_lineage(id, depth) AS (
           SELECT id, 0 FROM scopes WHERE id = ?
           UNION ALL
           SELECT s.parent_scope_id, scope_lineage.depth + 1
           FROM scopes s
           JOIN scope_lineage ON s.id = scope_lineage.id
           WHERE s.parent_scope_id IS NOT NULL
         )
         SELECT p.*
         FROM review_policies p
         LEFT JOIN scope_lineage ON p.scope_id = scope_lineage.id
         WHERE p.is_active = 1
           AND (p.scope_id IS NULL OR scope_lineage.id IS NOT NULL)
         ORDER BY
           CASE WHEN p.scope_id IS NULL THEN 1 ELSE 0 END,
           scope_lineage.depth ASC
         LIMIT 1`,
      )
      .get(scopeId) as ReviewPolicyRow | undefined;
    return row === undefined ? null : mapPolicy(row);
  }

  public listPolicies(
    scopeId?: string,
    includeInactive = false,
  ): ReviewPolicy[] {
    const filters = [includeInactive ? "1 = 1" : "is_active = 1"];
    const parameters: unknown[] = [];
    if (scopeId !== undefined) {
      filters.push("scope_id IS ?");
      parameters.push(scopeId);
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM review_policies
         WHERE ${filters.join(" AND ")}
         ORDER BY scope_id, version DESC`,
      )
      .all(...parameters) as ReviewPolicyRow[];
    return rows.map(mapPolicy);
  }

  public getMissingTrustedSources(
    sources: TrustedSourceIdentity[],
  ): TrustedSourceIdentity[] {
    const find = this.database.prepare(
      `SELECT 1 AS present
       FROM source_series ss
       JOIN sources s ON s.id = ss.current_source_id
       WHERE ss.source_kind = ? AND ss.external_id = ? AND s.deleted_at IS NULL`,
    );
    return sources.filter(
      ({ kind, externalId }) =>
        find.get(kind, externalId) === undefined,
    );
  }

  public getCandidatePolicyFacts(candidateId: string): CandidatePolicyFacts {
    const candidate = this.ingestionRepository.getCandidate(candidateId);
    if (candidate === null) {
      throw new Error(`Memory candidate not found: ${candidateId}`);
    }

    const evidenceRows = this.database
      .prepare(
        `SELECT
           e.source_record_id, e.evidence_role, e.excerpt,
           r.source_id, r.author_role, r.content, s.source_kind,
           COALESCE(ss.external_id, s.external_id) AS external_id
         FROM candidate_evidence e
         JOIN source_records r ON r.id = e.source_record_id
         JOIN sources s ON s.id = r.source_id
         LEFT JOIN source_versions sv ON sv.source_id = s.id
         LEFT JOIN source_series ss ON ss.id = sv.series_id
         WHERE e.candidate_id = ?
           AND r.deleted_at IS NULL
           AND s.deleted_at IS NULL
         ORDER BY e.created_at, e.source_record_id, e.evidence_role`,
      )
      .all(candidateId) as EvidenceFactRow[];

    const match = this.database
      .prepare(
        `SELECT 1 AS present
         FROM memory_items m
         JOIN memory_revisions r ON r.id = m.current_revision_id
         WHERE m.status = 'active'
           AND (
             (? IS NOT NULL AND r.normalized_assertion = ?)
             OR lower(trim(r.assertion)) = lower(trim(?))
           )
         LIMIT 1`,
      )
      .get(
        candidate.normalizedAssertion,
        candidate.normalizedAssertion,
        candidate.assertion,
      ) as { present: 1 } | undefined;

    return {
      candidate,
      evidence: evidenceRows.map((row) => ({
        sourceRecordId: row.source_record_id,
        role: row.evidence_role,
        excerpt: row.excerpt,
        sourceId: row.source_id,
        sourceKind: row.source_kind,
        sourceExternalId: row.external_id,
        authorRole: row.author_role,
        sourceContent: row.content,
      })),
      hasExactActiveMemoryMatch: match !== undefined,
    };
  }

  private requirePolicy(id: string): ReviewPolicy {
    const row = this.database
      .prepare("SELECT * FROM review_policies WHERE id = ?")
      .get(id) as ReviewPolicyRow | undefined;
    if (row === undefined) {
      throw new Error(`Review policy not found: ${id}`);
    }
    return mapPolicy(row);
  }

  private writeEvent(
    policyId: string,
    eventType: "created" | "activated" | "deactivated",
    detail: Record<string, unknown> = {},
  ): void {
    this.database
      .prepare(
        `INSERT INTO review_policy_events (
           id, policy_id, event_type, actor_type, detail_json
         ) VALUES (?, ?, ?, 'user', ?)`,
      )
      .run(randomUUID(), policyId, eventType, JSON.stringify(detail));
  }
}
