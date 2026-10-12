import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  CreateMemoryInput,
  CreateScopeInput,
  Explicitness,
  Memory,
  MemoryActor,
  MemoryChangeKind,
  MemoryRevision,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  RetrievalQuery,
  RetrievalPolicy,
  RetrievalResult,
  ReviseMemoryInput,
  Scope,
  ScopeKind,
  Sensitivity,
} from "../domain/memory.js";
import type { MemoryRepository } from "./memory-repository.js";

interface MemoryRow {
  id: string;
  memory_type: MemoryType;
  status: MemoryStatus;
  retrieval_policy: RetrievalPolicy;
  sensitivity: Sensitivity;
  is_pinned: 0 | 1;
  is_protected: 0 | 1;
  revision_id: string;
  revision_number: number;
  assertion: string;
  normalized_assertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  observed_at: string | null;
  created_at: string;
  updated_at: string;
  scopes_json: string;
}

interface MemoryRevisionRow {
  id: string;
  memory_id: string;
  revision_number: number;
  assertion: string;
  normalized_assertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  change_kind: MemoryChangeKind;
  previous_revision_id: string | null;
  observed_at: string | null;
  created_by: MemoryActor;
  created_at: string;
}

interface RetrievalRow {
  memory_id: string;
  relevance: number;
}

interface ScopeRow {
  id: string;
  scope_kind: ScopeKind;
  name: string;
  external_key: string | null;
  parent_scope_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapMemory(row: MemoryRow): Memory {
  const scopes = JSON.parse(row.scopes_json) as Array<{
    id: string;
    kind: MemoryScope["kind"];
    name: string;
    isPrimary: 0 | 1;
  }>;

  return {
    id: row.id,
    type: row.memory_type,
    status: row.status,
    retrievalPolicy: row.retrieval_policy,
    sensitivity: row.sensitivity,
    isPinned: row.is_pinned === 1,
    isProtected: row.is_protected === 1,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    assertion: row.assertion,
    normalizedAssertion: row.normalized_assertion,
    explicitness: row.explicitness,
    confidence: row.confidence,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scopes: scopes.map((scope) => ({
      id: scope.id,
      kind: scope.kind,
      name: scope.name,
      isPrimary: scope.isPrimary === 1,
    })),
  };
}

function mapRevision(row: MemoryRevisionRow): MemoryRevision {
  return {
    id: row.id,
    memoryId: row.memory_id,
    revisionNumber: row.revision_number,
    assertion: row.assertion,
    normalizedAssertion: row.normalized_assertion,
    explicitness: row.explicitness,
    confidence: row.confidence,
    changeKind: row.change_kind,
    previousRevisionId: row.previous_revision_id,
    observedAt: row.observed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapScope(row: ScopeRow): Scope {
  return {
    id: row.id,
    kind: row.scope_kind,
    name: row.name,
    externalKey: row.external_key,
    parentScopeId: row.parent_scope_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFtsQuery(query: string): string | null {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu);
  if (terms === null || terms.length === 0) {
    return null;
  }

  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
}

function validateAssertion(assertion: string): string {
  const trimmed = assertion.trim();
  if (trimmed.length === 0) {
    throw new Error("A memory assertion cannot be empty.");
  }
  return trimmed;
}

function validateConfidence(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Memory confidence must be between 0 and 1.");
  }
  return confidence;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export class SqliteMemoryRepository implements MemoryRepository {
  public constructor(private readonly database: Database.Database) {}

  public createScope(input: CreateScopeInput): Scope {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error("A scope name cannot be empty.");
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO scopes (
           id, scope_kind, name, external_key, parent_scope_id
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        name,
        input.externalKey ?? null,
        input.parentScopeId ?? null,
      );

    const scope = this.database
      .prepare(
        `SELECT
           id, scope_kind, name, external_key, parent_scope_id,
           created_at, updated_at
         FROM scopes
         WHERE id = ?`,
      )
      .get(id) as ScopeRow | undefined;

    if (scope === undefined) {
      throw new Error("The scope was created but could not be read back.");
    }
    return mapScope(scope);
  }

  public listScopes(): Scope[] {
    const rows = this.database
      .prepare(
        `SELECT
           id, scope_kind, name, external_key, parent_scope_id,
           created_at, updated_at
         FROM scopes
         ORDER BY scope_kind, name COLLATE NOCASE, id`,
      )
      .all() as ScopeRow[];

    return rows.map(mapScope);
  }

  public create(input: CreateMemoryInput): Memory {
    const assertion = validateAssertion(input.assertion);
    const confidence = validateConfidence(input.confidence ?? 1);

    const memoryId = randomUUID();
    const revisionId = randomUUID();
    const auditId = randomUUID();
    const createdBy: MemoryActor = input.createdBy ?? "user";

    const createTransaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO memory_items (
             id, memory_type, retrieval_policy, sensitivity, is_pinned, is_protected
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          memoryId,
          input.type,
          input.retrievalPolicy ?? "include",
          input.sensitivity ?? "normal",
          input.isPinned === true ? 1 : 0,
          input.isProtected === true ? 1 : 0,
        );

      this.database
        .prepare(
          `INSERT INTO memory_revisions (
             id, memory_id, revision_number, assertion, normalized_assertion,
             explicitness, confidence, change_kind, observed_at, created_by
           ) VALUES (?, ?, 1, ?, ?, ?, ?, 'created', ?, ?)`,
        )
        .run(
          revisionId,
          memoryId,
          assertion,
          input.normalizedAssertion ?? null,
          input.explicitness ?? "explicit",
          confidence,
          input.observedAt ?? null,
          createdBy,
        );

      this.database
        .prepare(
          `UPDATE memory_items
           SET current_revision_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(revisionId, memoryId);

      this.database
        .prepare(
          "INSERT INTO memory_scopes (memory_id, scope_id, is_primary) VALUES (?, ?, 1)",
        )
        .run(memoryId, input.scopeId);

      if (input.sourceRecordId !== undefined) {
        this.database
          .prepare(
            `INSERT INTO memory_evidence (
               memory_revision_id, source_record_id, evidence_role
             ) VALUES (?, ?, 'supports')`,
          )
          .run(revisionId, input.sourceRecordId);
      }

      const searchText = [assertion, input.normalizedAssertion]
        .filter((value): value is string => value !== undefined && value.length > 0)
        .join(" ");

      this.database
        .prepare(
          `INSERT INTO memory_search_documents (
             memory_id, revision_id, search_text
           ) VALUES (?, ?, ?)`,
        )
        .run(memoryId, revisionId, searchText);

      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, memory_id, event_type, actor_type, detail_json
           ) VALUES (?, ?, 'created', ?, '{}')`,
        )
        .run(auditId, memoryId, createdBy);
    });

    createTransaction();

    const memory = this.getById(memoryId);
    if (memory === null) {
      throw new Error("The memory was created but could not be read back.");
    }

    return memory;
  }

  public getById(id: string): Memory | null {
    const row = this.database
      .prepare(
        `SELECT
           m.id,
           m.memory_type,
           m.status,
           m.retrieval_policy,
           m.sensitivity,
           m.is_pinned,
           m.is_protected,
           r.id AS revision_id,
           r.revision_number,
           r.assertion,
           r.normalized_assertion,
           r.explicitness,
           r.confidence,
           r.observed_at,
           m.created_at,
           m.updated_at,
           COALESCE((
             SELECT json_group_array(json_object(
               'id', s.id,
               'kind', s.scope_kind,
               'name', s.name,
               'isPrimary', ms.is_primary
             ))
             FROM memory_scopes ms
             JOIN scopes s ON s.id = ms.scope_id
             WHERE ms.memory_id = m.id
           ), '[]') AS scopes_json
         FROM memory_items m
         JOIN memory_revisions r ON r.id = m.current_revision_id
         WHERE m.id = ?`,
      )
      .get(id) as MemoryRow | undefined;

    return row === undefined ? null : mapMemory(row);
  }

  public getHistory(id: string): MemoryRevision[] {
    const rows = this.database
      .prepare(
        `SELECT
           id, memory_id, revision_number, assertion, normalized_assertion,
           explicitness, confidence, change_kind, previous_revision_id,
           observed_at, created_by, created_at
         FROM memory_revisions
         WHERE memory_id = ?
         ORDER BY revision_number ASC`,
      )
      .all(id) as MemoryRevisionRow[];

    return rows.map(mapRevision);
  }

  public revise(
    id: string,
    input: ReviseMemoryInput,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    const revisionId = randomUUID();

    const reviseTransaction = this.database.transaction(() => {
      const current = this.requireMutable(id, actor, allowProtected);
      this.requireStatus(current, "active", "revise");
      const assertion = validateAssertion(input.assertion);
      const confidence = validateConfidence(input.confidence ?? current.confidence);
      const normalizedAssertion =
        input.normalizedAssertion === undefined
          ? current.normalizedAssertion
          : input.normalizedAssertion;
      const observedAt =
        input.observedAt === undefined ? current.observedAt : input.observedAt;
      const changeKind = input.changeKind ?? "edited";

      this.database
        .prepare(
          `INSERT INTO memory_revisions (
             id, memory_id, revision_number, assertion, normalized_assertion,
             explicitness, confidence, change_kind, previous_revision_id,
             observed_at, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          revisionId,
          id,
          current.revisionNumber + 1,
          assertion,
          normalizedAssertion,
          input.explicitness ?? current.explicitness,
          confidence,
          changeKind,
          current.revisionId,
          observedAt,
          actor,
        );

      this.database
        .prepare(
          `UPDATE memory_items
           SET current_revision_id = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(revisionId, id);

      const searchText = [assertion, normalizedAssertion]
        .filter((value): value is string => value !== null && value !== undefined && value.length > 0)
        .join(" ");

      this.database
        .prepare(
          `UPDATE memory_search_documents
           SET revision_id = ?, search_text = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE memory_id = ?`,
        )
        .run(revisionId, searchText, id);

      if (input.sourceRecordId !== undefined) {
        this.database
          .prepare(
            `INSERT INTO memory_evidence (
               memory_revision_id, source_record_id, evidence_role
             ) VALUES (?, ?, 'supports')`,
          )
          .run(revisionId, input.sourceRecordId);
      }

      this.writeAudit(id, "revised", actor, {
        changeKind,
        previousRevisionId: current.revisionId,
        revisionId,
      });
    });

    reviseTransaction();
    return this.requireMemory(id);
  }

  public archive(
    id: string,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    const archiveTransaction = this.database.transaction(() => {
      const current = this.requireMutable(id, actor, allowProtected);
      this.requireStatus(current, "active", "archive");

      this.database
        .prepare(
          `UPDATE memory_items
           SET status = 'archived',
               archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(id);
      this.writeAudit(id, "archived", actor);
    });

    archiveTransaction();
    return this.requireMemory(id);
  }

  public restore(
    id: string,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    const restoreTransaction = this.database.transaction(() => {
      const current = this.requireMutable(id, actor, allowProtected);
      this.requireStatus(current, "archived", "restore");

      this.database
        .prepare(
          `UPDATE memory_items
           SET status = 'active', archived_at = NULL,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(id);
      this.writeAudit(id, "restored", actor);
    });

    restoreTransaction();
    return this.requireMemory(id);
  }

  public supersede(
    id: string,
    replacementId: string,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    return this.transitionWithRelation(
      id,
      replacementId,
      "superseded",
      "supersedes",
      actor,
      allowProtected,
    );
  }

  public contradict(
    id: string,
    contradictingId: string,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    return this.transitionWithRelation(
      id,
      contradictingId,
      "contradicted",
      "contradicts",
      actor,
      allowProtected,
    );
  }

  public retrieve(query: RetrievalQuery): RetrievalResult[] {
    const ftsQuery = toFtsQuery(query.text);
    const scopeIds = [...new Set(query.scopeIds)];
    const allowedSensitivities = [
      ...new Set(query.allowedSensitivities ?? ["normal"]),
    ];

    if (
      ftsQuery === null ||
      scopeIds.length === 0 ||
      allowedSensitivities.length === 0
    ) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(Math.trunc(query.limit ?? 20), 100));
    const sql = `SELECT d.memory_id, bm25(memory_search_fts) AS relevance
      FROM memory_search_fts
      JOIN memory_search_documents d ON d.rowid = memory_search_fts.rowid
      JOIN memory_items m ON m.id = d.memory_id
      WHERE memory_search_fts MATCH ?
        AND m.status = 'active'
        AND m.retrieval_policy = 'include'
        AND m.sensitivity IN (${placeholders(allowedSensitivities)})
        AND EXISTS (
          SELECT 1
          FROM memory_scopes ms
          WHERE ms.memory_id = m.id
            AND ms.scope_id IN (${placeholders(scopeIds)})
        )
      ORDER BY m.is_pinned DESC, relevance ASC, m.updated_at DESC
      LIMIT ?`;

    const retrievalTransaction = this.database.transaction(() => {
      const rows = this.database
        .prepare(sql)
        .all(
          ftsQuery,
          ...allowedSensitivities,
          ...scopeIds,
          safeLimit,
        ) as RetrievalRow[];

      const retrievedAt = new Date().toISOString();
      for (const row of rows) {
        this.database
          .prepare(
            `UPDATE memory_items
             SET last_used_at = ?, use_count = use_count + 1
             WHERE id = ?`,
          )
          .run(retrievedAt, row.memory_id);
        this.writeAudit(row.memory_id, "retrieved", "client", {
          query: query.text,
          scopeIds,
        });
      }

      return rows;
    });

    return retrievalTransaction().flatMap((row, index) => {
      const memory = this.getById(row.memory_id);
      return memory === null ? [] : [{ memory, rank: index + 1 }];
    });
  }

  public search(query: string, limit = 20): Memory[] {
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery === null) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT d.memory_id
         FROM memory_search_fts
         JOIN memory_search_documents d ON d.rowid = memory_search_fts.rowid
         JOIN memory_items m ON m.id = d.memory_id
         WHERE memory_search_fts MATCH ?
           AND m.status = 'active'
           AND m.retrieval_policy = 'include'
         ORDER BY bm25(memory_search_fts), m.is_pinned DESC
         LIMIT ?`,
      )
      .all(ftsQuery, safeLimit) as Array<{ memory_id: string }>;

    return rows.flatMap(({ memory_id }) => {
      const memory = this.getById(memory_id);
      return memory === null ? [] : [memory];
    });
  }

  private transitionWithRelation(
    id: string,
    relatedMemoryId: string,
    status: "superseded" | "contradicted",
    relation: "supersedes" | "contradicts",
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    if (id === relatedMemoryId) {
      throw new Error("A memory cannot supersede or contradict itself.");
    }

    const transitionTransaction = this.database.transaction(() => {
      const current = this.requireMutable(id, actor, allowProtected);
      this.requireStatus(current, "active", status);

      const related = this.requireMemory(relatedMemoryId);
      this.requireStatus(related, "active", status);

      this.database
        .prepare(
          `UPDATE memory_items
           SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
        )
        .run(status, id);

      this.database
        .prepare(
          `INSERT INTO memory_relations (
             from_memory_id, to_memory_id, relation_type, created_by
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(relatedMemoryId, id, relation, actor);

      this.writeAudit(id, status, actor, { relatedMemoryId });
    });

    transitionTransaction();
    return this.requireMemory(id);
  }

  private requireMemory(id: string): Memory {
    const memory = this.getById(id);
    if (memory === null) {
      throw new Error(`Memory not found: ${id}`);
    }
    return memory;
  }

  private requireMutable(
    id: string,
    actor: MemoryActor,
    allowProtected: boolean,
  ): Memory {
    const memory = this.requireMemory(id);
    const hasExplicitUserAuthorization = actor === "user" && allowProtected;
    if (memory.isProtected && !hasExplicitUserAuthorization) {
      throw new Error(
        `Memory ${id} is protected. An explicit user action is required to modify it.`,
      );
    }
    return memory;
  }

  private requireStatus(
    memory: Memory,
    expected: MemoryStatus,
    operation: string,
  ): void {
    if (memory.status !== expected) {
      throw new Error(
        `Cannot ${operation} memory ${memory.id} while its status is ${memory.status}.`,
      );
    }
  }

  private writeAudit(
    memoryId: string,
    eventType:
      | "revised"
      | "retrieved"
      | "superseded"
      | "contradicted"
      | "archived"
      | "restored",
    actor: MemoryActor | "client",
    detail: Record<string, unknown> = {},
  ): void {
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, memory_id, event_type, actor_type, detail_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        memoryId,
        eventType,
        actor,
        JSON.stringify(detail),
      );
  }
}
