import type Database from "better-sqlite3";
import type { PersonaMemoryClass } from "../domain/continuity-memory.js";
import type { CandidateStatus } from "../domain/ingestion.js";
import type {
  ContinuityCandidateBinding,
  ContinuityControlRepository,
} from "./continuity-control-repository.js";

interface CandidateBindingRow {
  candidate_id: string;
  user_id: string;
  persona_id: string;
  relationship_id: string;
  memory_class: PersonaMemoryClass;
}

function mapBinding(row: CandidateBindingRow): ContinuityCandidateBinding {
  return {
    candidateId: row.candidate_id,
    userId: row.user_id,
    personaId: row.persona_id,
    relationshipId: row.relationship_id,
    memoryClass: row.memory_class,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("A control queue limit must be an integer from 1 through 500.");
  }
  return limit;
}

export class SqliteContinuityControlRepository
  implements ContinuityControlRepository
{
  public constructor(private readonly database: Database.Database) {}

  public getCandidateBinding(
    candidateId: string,
  ): ContinuityCandidateBinding | null {
    const row = this.database
      .prepare(
        `SELECT candidate_id, user_id, persona_id, relationship_id, memory_class
         FROM ambient_candidate_profiles
         WHERE candidate_id = ?`,
      )
      .get(candidateId) as CandidateBindingRow | undefined;
    return row === undefined ? null : mapBinding(row);
  }

  public listCandidateBindings(
    personaId: string,
    status?: CandidateStatus,
    limit?: number,
  ): ContinuityCandidateBinding[] {
    const rows = this.database
      .prepare(
        `SELECT
           profile.candidate_id, profile.user_id, profile.persona_id,
           profile.relationship_id, profile.memory_class
         FROM ambient_candidate_profiles profile
         JOIN memory_candidates candidate ON candidate.id = profile.candidate_id
         WHERE profile.persona_id = ?
           AND (? IS NULL OR candidate.status = ?)
         ORDER BY candidate.created_at, candidate.id
         LIMIT ?`,
      )
      .all(
        personaId,
        status ?? null,
        status ?? null,
        normalizeLimit(limit),
      ) as CandidateBindingRow[];
    return rows.map(mapBinding);
  }
}
