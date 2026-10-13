import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  PersonaRankingProfile,
  UpdatePersonaRankingProfileInput,
} from "../domain/continuity-ranking.js";
import type { ContinuityRankingRepository } from "./continuity-ranking-repository.js";

interface RankingProfileRow {
  id: string;
  persona_id: string;
  revision_number: number;
  lexical_weight: number;
  semantic_weight: number;
  pinned_boost: number;
  explicit_boost: number;
  episodic_boost: number;
  durable_boost: number;
  created_by: "user" | "system";
  note: string | null;
  created_at: string;
}

function mapProfile(row: RankingProfileRow): PersonaRankingProfile {
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
    createdBy: row.created_by,
    note: row.note,
    createdAt: row.created_at,
  };
}

function weight(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return value;
}

function note(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export class SqliteContinuityRankingRepository
  implements ContinuityRankingRepository
{
  public constructor(private readonly database: Database.Database) {}

  public getCurrentProfile(personaId: string): PersonaRankingProfile {
    const row = this.database
      .prepare(
        `SELECT
           id, persona_id, revision_number, lexical_weight, semantic_weight,
           pinned_boost, explicit_boost, episodic_boost, durable_boost,
           created_by, note, created_at
         FROM continuity_ranking_profiles
         WHERE persona_id = ?
         ORDER BY revision_number DESC
         LIMIT 1`,
      )
      .get(personaId) as RankingProfileRow | undefined;
    if (row === undefined) {
      const persona = this.database
        .prepare("SELECT 1 AS present FROM continuity_personas WHERE id = ?")
        .get(personaId);
      if (persona === undefined) {
        throw new Error(`Persona not found: ${personaId}`);
      }
      throw new Error(`Persona ${personaId} has no ranking profile.`);
    }
    return mapProfile(row);
  }

  public listProfileHistory(personaId: string): PersonaRankingProfile[] {
    this.getCurrentProfile(personaId);
    const rows = this.database
      .prepare(
        `SELECT
           id, persona_id, revision_number, lexical_weight, semantic_weight,
           pinned_boost, explicit_boost, episodic_boost, durable_boost,
           created_by, note, created_at
         FROM continuity_ranking_profiles
         WHERE persona_id = ?
         ORDER BY revision_number`,
      )
      .all(personaId) as RankingProfileRow[];
    return rows.map(mapProfile);
  }

  public appendProfile(
    input: UpdatePersonaRankingProfileInput,
    actor: "user" | "system",
  ): PersonaRankingProfile {
    let revisionNumber = 0;
    const append = this.database.transaction(() => {
      const current = this.getCurrentProfile(input.personaId);
      if (input.expectedRevisionNumber !== current.revisionNumber) {
        throw new Error(
          `Ranking profile changed from revision ${input.expectedRevisionNumber} to ${current.revisionNumber}; review it and try again.`,
        );
      }
      const lexicalWeight = weight(
        input.lexicalWeight ?? current.lexicalWeight,
        "lexicalWeight",
      );
      const semanticWeight = weight(
        input.semanticWeight ?? current.semanticWeight,
        "semanticWeight",
      );
      if (lexicalWeight + semanticWeight === 0) {
        throw new Error("Lexical and semantic weights cannot both be zero.");
      }
      revisionNumber = current.revisionNumber + 1;
      this.database
        .prepare(
          `INSERT INTO continuity_ranking_profiles (
             id, persona_id, revision_number, lexical_weight, semantic_weight,
             pinned_boost, explicit_boost, episodic_boost, durable_boost,
             created_by, note
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.personaId,
          revisionNumber,
          lexicalWeight,
          semanticWeight,
          weight(input.pinnedBoost ?? current.pinnedBoost, "pinnedBoost"),
          weight(input.explicitBoost ?? current.explicitBoost, "explicitBoost"),
          weight(input.episodicBoost ?? current.episodicBoost, "episodicBoost"),
          weight(input.durableBoost ?? current.durableBoost, "durableBoost"),
          actor,
          note(input.note),
        );
    });
    append();
    const profile = this.getCurrentProfile(input.personaId);
    if (profile.revisionNumber !== revisionNumber) {
      throw new Error("The ranking profile revision was not stored.");
    }
    return profile;
  }
}
