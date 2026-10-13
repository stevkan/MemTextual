import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
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
import type { MemoryRepository } from "./memory-repository.js";

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

export class SqliteContinuityMemoryRepository
  implements ContinuityMemoryRepository
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
            }),
            retrievedAt,
          );
      }
      return rows;
    });

    return retrieve().map((row, index) => ({
      personaMemory: this.requireProfile(row.memory_id),
      rank: index + 1,
    }));
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

  private requireProfile(memoryId: string): PersonaMemory {
    const profile = this.getById(memoryId);
    if (profile === null) {
      throw new Error(`Persona memory profile not found: ${memoryId}`);
    }
    return profile;
  }
}
