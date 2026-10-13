import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import type {
  ContinuityEmbeddingSource,
  ContinuityHybridRetrievalQuery,
  ContinuityQueryEmbedding,
  PersonaMemoryHybridRetrievalResult,
  StoreContinuityEmbeddingInput,
  StoredContinuityEmbedding,
} from "../domain/continuity-embedding.js";
import type { PersonaRankingProfile } from "../domain/continuity-ranking.js";
import {
  emotionalRelevanceScore,
  validateEmotionalContext,
} from "../emotion/emotional-relevance.js";
import {
  personaMemoryClasses,
  type ContinuityRetrievalQuery,
  type CreatePersonaMemoryInput,
  type PersonaMemory,
  type PersonaMemoryClass,
  type PersonaMemoryRetrievalResult,
} from "../domain/continuity-memory.js";
import {
  normalizeRetrievalLimit,
  sqlPlaceholders,
  toFtsQuery,
} from "../search/fts-query.js";
import type { ContinuityMemoryRepository } from "./continuity-memory-repository.js";
import type { ContinuityEmbeddingRepository } from "./continuity-embedding-repository.js";
import type { MemoryRepository } from "./memory-repository.js";
import { resolveAsOf, temporalState } from "../temporal/temporal-relevance.js";

interface PersonaMemoryContextRow {
  user_id: string;
  persona_id: string;
  relationship_id: string;
  relationship_scope_id: string;
}

interface PersonaMemoryProfileRow {
  memory_id: string;
  user_id: string;
  persona_id: string;
  relationship_id: string;
  memory_class: PersonaMemoryClass;
  created_at: string;
  updated_at: string;
}

interface ContinuityRetrievalRow {
  memory_id: string;
  relevance: number;
}

interface HybridCandidateRow {
  memory_id: string;
  relevance: number | null;
  is_pinned: number;
  updated_at: string;
  vector_ref: string | null;
  explicitness: "explicit" | "inferred";
  memory_class: PersonaMemoryClass;
  emotion_revision_number: number | null;
  emotion_valence: number | null;
  emotion_activation: number | null;
  emotion_salience: number | null;
}

interface StoredEmbeddingRow {
  id: string;
  memory_revision_id: string;
  provider: string;
  model: string;
  dimensions: number;
  content_hash: string;
  created_at: string;
}

const inlineVectorPrefix = "memtextual:inline-f64le:";

function encodeVector(vector: readonly number[]): string {
  const bytes = Buffer.allocUnsafe(vector.length * 8);
  vector.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return `${inlineVectorPrefix}${bytes.toString("base64")}`;
}

function decodeVector(reference: string, dimensions: number): number[] | null {
  if (!reference.startsWith(inlineVectorPrefix)) {
    return null;
  }
  const bytes = Buffer.from(reference.slice(inlineVectorPrefix.length), "base64");
  if (bytes.length !== dimensions * 8) {
    return null;
  }
  const vector = Array.from({ length: dimensions }, (_, index) =>
    bytes.readDoubleLE(index * 8),
  );
  return vector.every(Number.isFinite) ? vector : null;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number | null {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) {
      return null;
    }
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function normalizeCandidateLimit(
  limit: number | undefined,
  minimum: number,
): number {
  const value = limit ?? 500;
  if (!Number.isFinite(value)) {
    throw new Error("A hybrid candidate limit must be a finite number.");
  }
  return Math.max(minimum, Math.min(Math.trunc(value), 1_000));
}

function resolveWeights(profile: PersonaRankingProfile): {
  lexical: number;
  semantic: number;
} {
  const lexical = profile.lexicalWeight;
  const semantic = profile.semanticWeight;
  if (
    !Number.isFinite(lexical) ||
    !Number.isFinite(semantic) ||
    lexical < 0 ||
    semantic < 0 ||
    lexical + semantic === 0
  ) {
    throw new Error(
      "Hybrid retrieval weights must be finite, non-negative, and not both zero.",
    );
  }
  const total = lexical + semantic;
  return { lexical: lexical / total, semantic: semantic / total };
}

export class SqliteContinuityMemoryRepository
  implements ContinuityMemoryRepository, ContinuityEmbeddingRepository
{
  public constructor(
    private readonly database: Database.Database,
    private readonly memories: MemoryRepository,
  ) {}

  public create(input: CreatePersonaMemoryInput): PersonaMemory {
    if (!personaMemoryClasses.includes(input.memoryClass)) {
      throw new Error(`Unsupported persona memory class: ${input.memoryClass}.`);
    }
    const { personaId, memoryClass, ...memoryInput } = input;
    let memoryId: string | null = null;
    const create = this.database.transaction(() => {
      const context = this.requirePersonaContext(personaId);
      const memory = this.memories.create({
        ...memoryInput,
        scopeId: context.relationship_scope_id,
      });
      this.database
        .prepare(
          `INSERT INTO continuity_memory_profiles (
             memory_id, user_id, persona_id, relationship_id, memory_class
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          memory.id,
          context.user_id,
          context.persona_id,
          context.relationship_id,
          memoryClass,
        );
      memoryId = memory.id;
    });
    create();
    if (memoryId === null) {
      throw new Error("The persona memory transaction did not create a memory.");
    }
    return this.requireProfile(memoryId);
  }

  public getById(memoryId: string): PersonaMemory | null {
    const row = this.database
      .prepare(
        `SELECT
           memory_id, user_id, persona_id, relationship_id, memory_class,
           created_at, updated_at
         FROM continuity_memory_profiles
         WHERE memory_id = ?`,
      )
      .get(memoryId) as PersonaMemoryProfileRow | undefined;
    if (row === undefined) {
      return null;
    }
    const memory = this.memories.getById(row.memory_id);
    if (memory === null) {
      throw new Error(`Persona memory ${row.memory_id} has no core memory.`);
    }
    return {
      memory,
      userId: row.user_id,
      personaId: row.persona_id,
      relationshipId: row.relationship_id,
      memoryClass: row.memory_class,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listForPersona(
    personaId: string,
    memoryClass?: PersonaMemoryClass,
  ): PersonaMemory[] {
    this.requirePersonaContext(personaId);
    if (
      memoryClass !== undefined &&
      !personaMemoryClasses.includes(memoryClass)
    ) {
      throw new Error(`Unsupported persona memory class: ${memoryClass}.`);
    }
    const rows = this.database
      .prepare(
        `SELECT profile.memory_id
         FROM continuity_memory_profiles profile
         JOIN memory_items memory ON memory.id = profile.memory_id
         WHERE profile.persona_id = ?
           AND (? IS NULL OR profile.memory_class = ?)
         ORDER BY memory.created_at DESC, profile.memory_id`,
      )
      .all(personaId, memoryClass ?? null, memoryClass ?? null) as Array<{
      memory_id: string;
    }>;
    return rows.map(({ memory_id: id }) => this.requireProfile(id));
  }

  public retrieve(
    query: ContinuityRetrievalQuery,
  ): PersonaMemoryRetrievalResult[] {
    const context = this.requirePersonaContext(query.personaId);
    const ftsQuery = toFtsQuery(query.text);
    const memoryClasses = [
      ...new Set(query.memoryClasses ?? personaMemoryClasses),
    ];
    const allowedSensitivities = [
      ...new Set(query.allowedSensitivities ?? ["normal"]),
    ];
    const asOf = resolveAsOf(query.asOf);
    const includeOutOfWindow = query.includeOutOfWindow === true;
    if (
      memoryClasses.some(
        (memoryClass) => !personaMemoryClasses.includes(memoryClass),
      )
    ) {
      throw new Error("Continuity retrieval contains an unsupported memory class.");
    }
    if (
      ftsQuery === null ||
      memoryClasses.length === 0 ||
      allowedSensitivities.length === 0
    ) {
      return [];
    }

    const safeLimit = normalizeRetrievalLimit(query.limit);
    const sql = `SELECT
        document.memory_id,
        bm25(memory_search_fts) AS relevance
      FROM memory_search_fts
      JOIN memory_search_documents document
        ON document.rowid = memory_search_fts.rowid
      JOIN memory_items memory ON memory.id = document.memory_id
      JOIN memory_revisions revision ON revision.id = memory.current_revision_id
      JOIN continuity_memory_profiles profile
        ON profile.memory_id = memory.id
      JOIN continuity_relationships relationship
        ON relationship.id = profile.relationship_id
      WHERE memory_search_fts MATCH ?
        AND profile.persona_id = ?
        AND profile.relationship_id = ?
        AND relationship.scope_id = ?
        AND profile.memory_class IN (${sqlPlaceholders(memoryClasses)})
        AND memory.status = 'active'
        AND memory.retrieval_policy = 'include'
        AND memory.sensitivity IN (${sqlPlaceholders(allowedSensitivities)})
        AND (
          ? = 1
          OR (
            (
              revision.valid_from IS NULL
              OR julianday(revision.valid_from) <= julianday(?)
            )
            AND (
              revision.valid_to IS NULL
              OR julianday(revision.valid_to) >= julianday(?)
            )
          )
        )
        AND EXISTS (
          SELECT 1
          FROM memory_scopes binding
          WHERE binding.memory_id = memory.id
            AND binding.scope_id = relationship.scope_id
            AND binding.is_primary = 1
        )
      ORDER BY memory.is_pinned DESC, relevance ASC, memory.updated_at DESC
      LIMIT ?`;

    const retrieve = this.database.transaction(() => {
      const rows = this.database
        .prepare(sql)
        .all(
          ftsQuery,
          context.persona_id,
          context.relationship_id,
          context.relationship_scope_id,
          ...memoryClasses,
          ...allowedSensitivities,
          includeOutOfWindow ? 1 : 0,
          asOf,
          asOf,
          safeLimit,
        ) as ContinuityRetrievalRow[];
      const retrievedAt = new Date().toISOString();
      for (const row of rows) {
        this.database
          .prepare(
            `UPDATE memory_items
             SET last_used_at = ?, use_count = use_count + 1
             WHERE id = ?`,
          )
          .run(retrievedAt, row.memory_id);
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, memory_id, event_type, actor_type, detail_json, occurred_at
             ) VALUES (?, ?, 'retrieved', 'client', ?, ?)`,
          )
          .run(
            randomUUID(),
            row.memory_id,
            JSON.stringify({
              query: query.text,
              personaId: context.persona_id,
              relationshipId: context.relationship_id,
              memoryClasses,
              asOf,
              includeOutOfWindow,
            }),
            retrievedAt,
          );
      }
      return rows;
    });

    return retrieve().map((row, index) => {
      const personaMemory = this.requireProfile(row.memory_id);
      return {
        personaMemory,
        rank: index + 1,
        ...temporalState(personaMemory.memory, asOf),
      };
    });
  }

  public getEmbeddingSource(
    personaId: string,
    memoryId: string,
  ): ContinuityEmbeddingSource {
    this.requirePersonaContext(personaId);
    const row = this.database
      .prepare(
        `SELECT document.memory_id, document.revision_id, document.search_text
         FROM memory_search_documents document
         JOIN memory_items memory ON memory.id = document.memory_id
         JOIN continuity_memory_profiles profile
           ON profile.memory_id = memory.id
         WHERE document.memory_id = ?
           AND document.revision_id = memory.current_revision_id
           AND profile.persona_id = ?`,
      )
      .get(memoryId, personaId) as
      | { memory_id: string; revision_id: string; search_text: string }
      | undefined;
    if (row === undefined) {
      throw new Error(
        `Persona memory not found for embedding: ${memoryId}.`,
      );
    }
    return {
      memoryId: row.memory_id,
      revisionId: row.revision_id,
      text: row.search_text,
    };
  }

  public preflightHybridRetrieval(
    query: ContinuityHybridRetrievalQuery,
  ): boolean {
    this.requirePersonaContext(query.personaId);
    const memoryClasses = [
      ...new Set(query.memoryClasses ?? personaMemoryClasses),
    ];
    const allowedSensitivities = [
      ...new Set(query.allowedSensitivities ?? ["normal"]),
    ];
    if (
      memoryClasses.some(
        (memoryClass) => !personaMemoryClasses.includes(memoryClass),
      )
    ) {
      throw new Error("Continuity retrieval contains an unsupported memory class.");
    }
    const safeLimit = normalizeRetrievalLimit(query.limit);
    normalizeCandidateLimit(query.candidateLimit, safeLimit);
    resolveWeights(this.requireRankingProfile(query.personaId));
    if (query.emotionalContext !== undefined) {
      validateEmotionalContext(query.emotionalContext);
    }
    resolveAsOf(query.asOf);
    return memoryClasses.length > 0 && allowedSensitivities.length > 0;
  }

  public storeEmbedding(
    input: StoreContinuityEmbeddingInput,
  ): StoredContinuityEmbedding {
    if (
      input.provider.trim().length === 0 ||
      input.model.trim().length === 0 ||
      !Number.isSafeInteger(input.dimensions) ||
      input.dimensions <= 0 ||
      input.vector.length !== input.dimensions ||
      input.vector.some((value) => !Number.isFinite(value)) ||
      input.vector.every((value) => value === 0)
    ) {
      throw new Error("The embedding vector is invalid.");
    }
    const current = this.database
      .prepare(
        `SELECT document.search_text
         FROM memory_search_documents document
         JOIN memory_items memory ON memory.id = document.memory_id
         WHERE document.memory_id = ?
           AND document.revision_id = ?
           AND memory.current_revision_id = document.revision_id`,
      )
      .get(input.memoryId, input.revisionId) as
      | { search_text: string }
      | undefined;
    const currentHash =
      current === undefined
        ? null
        : createHash("sha256")
            .update(current.search_text, "utf8")
            .digest("hex");
    if (currentHash !== input.contentHash || current?.search_text !== input.text) {
      throw new Error(
        "The memory changed while its embedding was being generated; index it again.",
      );
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO memory_embeddings (
           id, memory_revision_id, provider, model, dimensions, vector_ref,
           content_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_revision_id, provider, model) DO UPDATE SET
           dimensions = excluded.dimensions,
           vector_ref = excluded.vector_ref,
           content_hash = excluded.content_hash,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(
        id,
        input.revisionId,
        input.provider,
        input.model,
        input.dimensions,
        encodeVector(input.vector),
        input.contentHash,
      );
    const row = this.database
      .prepare(
        `SELECT id, memory_revision_id, provider, model, dimensions,
                content_hash, created_at
         FROM memory_embeddings
         WHERE memory_revision_id = ? AND provider = ? AND model = ?`,
      )
      .get(input.revisionId, input.provider, input.model) as StoredEmbeddingRow;
    return {
      id: row.id,
      memoryId: input.memoryId,
      revisionId: row.memory_revision_id,
      provider: row.provider,
      model: row.model,
      dimensions: row.dimensions,
      contentHash: row.content_hash,
      createdAt: row.created_at,
    };
  }

  public retrieveHybrid(
    query: ContinuityHybridRetrievalQuery,
    queryEmbedding: ContinuityQueryEmbedding,
  ): PersonaMemoryHybridRetrievalResult[] {
    if (!this.preflightHybridRetrieval(query)) {
      return [];
    }
    const context = this.requirePersonaContext(query.personaId);
    const rankingProfile = this.requireRankingProfile(query.personaId);
    const memoryClasses = [
      ...new Set(query.memoryClasses ?? personaMemoryClasses),
    ];
    const allowedSensitivities = [
      ...new Set(query.allowedSensitivities ?? ["normal"]),
    ];
    if (
      queryEmbedding.provider.trim().length === 0 ||
      queryEmbedding.model.trim().length === 0 ||
      !Number.isSafeInteger(queryEmbedding.dimensions) ||
      queryEmbedding.dimensions <= 0 ||
      queryEmbedding.vector.length !== queryEmbedding.dimensions ||
      queryEmbedding.vector.some((value) => !Number.isFinite(value)) ||
      queryEmbedding.vector.every((value) => value === 0)
    ) {
      throw new Error("The query embedding is invalid.");
    }

    const safeLimit = normalizeRetrievalLimit(query.limit);
    const candidateLimit = normalizeCandidateLimit(
      query.candidateLimit,
      safeLimit,
    );
    const weights = resolveWeights(rankingProfile);
    const ftsQuery = toFtsQuery(query.text) ?? "__memtextual_no_lexical_match__";
    const asOf = resolveAsOf(query.asOf);
    const includeOutOfWindow = query.includeOutOfWindow === true;
    const sql = `WITH lexical AS (
        SELECT document.memory_id, bm25(memory_search_fts) AS relevance
        FROM memory_search_fts
        JOIN memory_search_documents document
          ON document.rowid = memory_search_fts.rowid
        WHERE memory_search_fts MATCH ?
      )
      SELECT
        memory.id AS memory_id,
        lexical.relevance,
        memory.is_pinned,
        memory.updated_at,
        embedding.vector_ref,
        revision.explicitness,
        profile.memory_class,
        emotion.revision_number AS emotion_revision_number,
        emotion.valence AS emotion_valence,
        emotion.activation AS emotion_activation,
        emotion.salience AS emotion_salience
      FROM memory_items memory
      JOIN memory_revisions revision ON revision.id = memory.current_revision_id
      JOIN continuity_memory_profiles profile ON profile.memory_id = memory.id
      JOIN continuity_relationships relationship
        ON relationship.id = profile.relationship_id
      LEFT JOIN lexical ON lexical.memory_id = memory.id
      LEFT JOIN memory_embeddings embedding
        ON embedding.memory_revision_id = memory.current_revision_id
       AND embedding.provider = ?
       AND embedding.model = ?
       AND embedding.dimensions = ?
      LEFT JOIN continuity_emotional_profiles emotion
        ON emotion.memory_revision_id = memory.current_revision_id
       AND emotion.persona_id = profile.persona_id
       AND emotion.revision_number = (
         SELECT MAX(current_emotion.revision_number)
         FROM continuity_emotional_profiles current_emotion
         WHERE current_emotion.memory_revision_id = memory.current_revision_id
       )
      WHERE profile.persona_id = ?
        AND profile.relationship_id = ?
        AND relationship.scope_id = ?
        AND profile.memory_class IN (${sqlPlaceholders(memoryClasses)})
        AND memory.status = 'active'
        AND memory.retrieval_policy = 'include'
        AND memory.sensitivity IN (${sqlPlaceholders(allowedSensitivities)})
        AND (
          ? = 1
          OR (
            (revision.valid_from IS NULL OR julianday(revision.valid_from) <= julianday(?))
            AND (revision.valid_to IS NULL OR julianday(revision.valid_to) >= julianday(?))
          )
        )
        AND EXISTS (
          SELECT 1 FROM memory_scopes binding
          WHERE binding.memory_id = memory.id
            AND binding.scope_id = relationship.scope_id
            AND binding.is_primary = 1
        )
      ORDER BY memory.is_pinned DESC,
               lexical.relevance IS NULL,
               lexical.relevance ASC,
               memory.updated_at DESC
      LIMIT ?`;
    const rows = this.database
      .prepare(sql)
      .all(
        ftsQuery,
        queryEmbedding.provider,
        queryEmbedding.model,
        queryEmbedding.dimensions,
        context.persona_id,
        context.relationship_id,
        context.relationship_scope_id,
        ...memoryClasses,
        ...allowedSensitivities,
        includeOutOfWindow ? 1 : 0,
        asOf,
        asOf,
        candidateLimit,
      ) as HybridCandidateRow[];

    const lexicalRows = rows
      .filter((row) => row.relevance !== null)
      .sort((left, right) => (left.relevance ?? 0) - (right.relevance ?? 0));
    const lexicalScores = new Map(
      lexicalRows.map((row, index) => [row.memory_id, 1 / (index + 1)]),
    );
    const ranked = rows
      .map((row) => {
        const storedVector =
          row.vector_ref === null
            ? null
            : decodeVector(row.vector_ref, queryEmbedding.dimensions);
        const similarity =
          storedVector === null
            ? null
            : cosineSimilarity(storedVector, queryEmbedding.vector);
        const semanticScore =
          similarity === null
            ? null
            : Math.max(0, Math.min(1, (similarity + 1) / 2));
        const lexicalScore = lexicalScores.get(row.memory_id) ?? 0;
        const rankingSignals = {
          pinned: row.is_pinned === 1,
          explicit: row.explicitness === "explicit",
          memoryClass: row.memory_class,
        };
        const rankingBoost =
          (rankingSignals.pinned ? rankingProfile.pinnedBoost : 0) +
          (rankingSignals.explicit ? rankingProfile.explicitBoost : 0) +
          (rankingSignals.memoryClass === "episodic"
            ? rankingProfile.episodicBoost
            : rankingProfile.durableBoost);
        const emotionalScore =
          query.emotionalContext === undefined ||
          row.emotion_valence === null ||
          row.emotion_activation === null ||
          row.emotion_salience === null
            ? null
            : emotionalRelevanceScore(query.emotionalContext, {
                valence: row.emotion_valence,
                activation: row.emotion_activation,
                salience: row.emotion_salience,
              });
        return {
          ...row,
          lexicalScore,
          semanticScore,
          rankingBoost,
          rankingSignals,
          emotionalScore,
          combinedScore:
            weights.lexical * lexicalScore +
            weights.semantic * (semanticScore ?? 0) +
            rankingBoost +
            rankingProfile.emotionalWeight * (emotionalScore ?? 0),
        };
      })
      .filter((row) => row.lexicalScore > 0 || row.semanticScore !== null)
      .sort(
        (left, right) =>
          right.combinedScore - left.combinedScore ||
          right.is_pinned - left.is_pinned ||
          right.updated_at.localeCompare(left.updated_at) ||
          left.memory_id.localeCompare(right.memory_id),
      )
      .slice(0, safeLimit);

    const recordRetrieval = this.database.transaction(() => {
      const retrievedAt = new Date().toISOString();
      for (const row of ranked) {
        this.database
          .prepare(
            `UPDATE memory_items
             SET last_used_at = ?, use_count = use_count + 1
             WHERE id = ?`,
          )
          .run(retrievedAt, row.memory_id);
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, memory_id, event_type, actor_type, detail_json, occurred_at
             ) VALUES (?, ?, 'retrieved', 'client', ?, ?)`,
          )
          .run(
            randomUUID(),
            row.memory_id,
            JSON.stringify({
              query: query.text,
              personaId: context.persona_id,
              relationshipId: context.relationship_id,
              memoryClasses,
              asOf,
              includeOutOfWindow,
              retrievalMode: "hybrid",
              embeddingProvider: queryEmbedding.provider,
              embeddingModel: queryEmbedding.model,
              rankingProfileRevision: rankingProfile.revisionNumber,
              emotionalContextApplied: query.emotionalContext !== undefined,
              emotionalProfileRevision: row.emotion_revision_number,
            }),
            retrievedAt,
          );
      }
    });
    recordRetrieval();

    return ranked.map((row, index) => {
      const personaMemory = this.requireProfile(row.memory_id);
      return {
        personaMemory,
        rank: index + 1,
        lexicalScore: row.lexicalScore,
        semanticScore: row.semanticScore,
        emotionalScore: row.emotionalScore,
        emotionalProfileRevision: row.emotion_revision_number,
        rankingBoost: row.rankingBoost,
        rankingProfileRevision: rankingProfile.revisionNumber,
        rankingSignals: row.rankingSignals,
        combinedScore: row.combinedScore,
        ...temporalState(personaMemory.memory, asOf),
      };
    });
  }

  private requirePersonaContext(personaId: string): PersonaMemoryContextRow {
    const row = this.database
      .prepare(
        `SELECT
           persona.user_id,
           persona.id AS persona_id,
           relationship.id AS relationship_id,
           relationship.scope_id AS relationship_scope_id
         FROM continuity_personas persona
         JOIN continuity_relationships relationship
           ON relationship.persona_id = persona.id
          AND relationship.user_id = persona.user_id
         WHERE persona.id = ?`,
      )
      .get(personaId) as PersonaMemoryContextRow | undefined;
    if (row === undefined) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    return row;
  }

  private requireRankingProfile(personaId: string): PersonaRankingProfile {
    const row = this.database
      .prepare(
        `SELECT
           id, persona_id, revision_number, lexical_weight, semantic_weight,
           pinned_boost, explicit_boost, episodic_boost, durable_boost,
           emotional_weight, created_by, note, created_at
         FROM continuity_ranking_profiles
         WHERE persona_id = ?
         ORDER BY revision_number DESC
         LIMIT 1`,
      )
      .get(personaId) as
      | {
          id: string;
          persona_id: string;
          revision_number: number;
          lexical_weight: number;
          semantic_weight: number;
          pinned_boost: number;
          explicit_boost: number;
          episodic_boost: number;
          durable_boost: number;
          emotional_weight: number;
          created_by: "user" | "system";
          note: string | null;
          created_at: string;
        }
      | undefined;
    if (row === undefined) {
      throw new Error(`Persona ${personaId} has no ranking profile.`);
    }
    return {
      id: row.id,
      personaId: row.persona_id,
      revisionNumber: row.revision_number,
      lexicalWeight: row.lexical_weight,
      semanticWeight: row.semantic_weight,
      pinnedBoost: row.pinned_boost,
      explicitBoost: row.explicit_boost,
      episodicBoost: row.episodic_boost,
      durableBoost: row.durable_boost,
      emotionalWeight: row.emotional_weight,
      createdBy: row.created_by,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  private requireProfile(memoryId: string): PersonaMemory {
    const profile = this.getById(memoryId);
    if (profile === null) {
      throw new Error(`Persona memory profile not found: ${memoryId}`);
    }
    return profile;
  }
}
