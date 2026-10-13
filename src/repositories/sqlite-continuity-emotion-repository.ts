import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AnnotatePersonaMemoryEmotionInput,
  PersonaMemoryEmotionProfile,
} from "../domain/continuity-emotion.js";
import { validateEmotionalContext } from "../emotion/emotional-relevance.js";
import type { ContinuityEmotionRepository } from "./continuity-emotion-repository.js";

interface EmotionProfileRow {
  id: string;
  persona_id: string;
  memory_id: string;
  memory_revision_id: string;
  revision_number: number;
  valence: number;
  activation: number;
  salience: number;
  created_by: "user";
  note: string | null;
  created_at: string;
}

function mapProfile(row: EmotionProfileRow): PersonaMemoryEmotionProfile {
  return {
    id: row.id,
    personaId: row.persona_id,
    memoryId: row.memory_id,
    memoryRevisionId: row.memory_revision_id,
    revisionNumber: row.revision_number,
    valence: row.valence,
    activation: row.activation,
    salience: row.salience,
    createdBy: row.created_by,
    note: row.note,
    createdAt: row.created_at,
  };
}

function normalizeNote(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export class SqliteContinuityEmotionRepository
  implements ContinuityEmotionRepository
{
  public constructor(private readonly database: Database.Database) {}

  public getCurrentEmotionProfile(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile | null {
    const memoryRevisionId = this.requireCurrentRevision(personaId, memoryId);
    const row = this.database
      .prepare(
        `SELECT
           emotion.id, emotion.persona_id, revision.memory_id,
           emotion.memory_revision_id, emotion.revision_number,
           emotion.valence, emotion.activation, emotion.salience,
           emotion.created_by, emotion.note, emotion.created_at
         FROM continuity_emotional_profiles emotion
         JOIN memory_revisions revision ON revision.id = emotion.memory_revision_id
         WHERE emotion.memory_revision_id = ?
           AND emotion.persona_id = ?
         ORDER BY emotion.revision_number DESC
         LIMIT 1`,
      )
      .get(memoryRevisionId, personaId) as EmotionProfileRow | undefined;
    return row === undefined ? null : mapProfile(row);
  }

  public listEmotionProfileHistory(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile[] {
    this.requireCurrentRevision(personaId, memoryId);
    const rows = this.database
      .prepare(
        `SELECT
           emotion.id, emotion.persona_id, revision.memory_id,
           emotion.memory_revision_id, emotion.revision_number,
           emotion.valence, emotion.activation, emotion.salience,
           emotion.created_by, emotion.note, emotion.created_at
         FROM continuity_emotional_profiles emotion
         JOIN memory_revisions revision ON revision.id = emotion.memory_revision_id
         JOIN continuity_memory_profiles profile
           ON profile.memory_id = revision.memory_id
         WHERE revision.memory_id = ?
           AND emotion.persona_id = ?
           AND profile.persona_id = ?
         ORDER BY revision.revision_number, emotion.revision_number`,
      )
      .all(memoryId, personaId, personaId) as EmotionProfileRow[];
    return rows.map(mapProfile);
  }

  public appendEmotionProfile(
    input: AnnotatePersonaMemoryEmotionInput,
  ): PersonaMemoryEmotionProfile {
    if (
      !Number.isSafeInteger(input.expectedProfileRevision) ||
      input.expectedProfileRevision < 0
    ) {
      throw new Error("expectedProfileRevision must be a non-negative integer.");
    }
    const emotionalContext = validateEmotionalContext(input);
    let memoryRevisionId = "";
    let revisionNumber = 0;
    const append = this.database.transaction(() => {
      memoryRevisionId = this.requireCurrentRevision(
        input.personaId,
        input.memoryId,
        true,
      );
      const current = this.getCurrentEmotionProfile(
        input.personaId,
        input.memoryId,
      );
      const currentRevision = current?.revisionNumber ?? 0;
      if (input.expectedProfileRevision !== currentRevision) {
        throw new Error(
          `Emotional profile changed from revision ${input.expectedProfileRevision} to ${currentRevision}; review it and try again.`,
        );
      }
      revisionNumber = currentRevision + 1;
      this.database
        .prepare(
          `INSERT INTO continuity_emotional_profiles (
             id, memory_revision_id, persona_id, revision_number,
             valence, activation, salience, created_by, note
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
        )
        .run(
          randomUUID(),
          memoryRevisionId,
          input.personaId,
          revisionNumber,
          emotionalContext.valence,
          emotionalContext.activation,
          emotionalContext.salience,
          normalizeNote(input.note),
        );
    });
    append();
    const profile = this.getCurrentEmotionProfile(
      input.personaId,
      input.memoryId,
    );
    if (
      profile === null ||
      profile.memoryRevisionId !== memoryRevisionId ||
      profile.revisionNumber !== revisionNumber
    ) {
      throw new Error("The emotional profile revision was not stored.");
    }
    return profile;
  }

  private requireCurrentRevision(
    personaId: string,
    memoryId: string,
    requireRetained = false,
  ): string {
    const row = this.database
      .prepare(
        `SELECT memory.current_revision_id, memory.status
         FROM memory_items memory
         JOIN continuity_memory_profiles profile ON profile.memory_id = memory.id
         WHERE memory.id = ?
           AND profile.persona_id = ?
           AND memory.current_revision_id IS NOT NULL`,
      )
      .get(memoryId, personaId) as
      | { current_revision_id: string; status: string }
      | undefined;
    if (row === undefined) {
      throw new Error(`Persona memory not found: ${memoryId}.`);
    }
    if (requireRetained && row.status === "deleted") {
      throw new Error(`Deleted memory cannot receive emotional annotations: ${memoryId}.`);
    }
    return row.current_revision_id;
  }
}
