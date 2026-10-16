import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ConfigurePersonaBehaviorProfileInput,
  PersonaBehaviorProfile,
} from "../domain/continuity-persona-behavior.js";
import type { ContinuityPersonaBehaviorRepository } from "./continuity-persona-behavior-repository.js";

interface PersonaBehaviorProfileRow {
  id: string;
  persona_id: string;
  revision_number: number;
  instructions: string;
  is_enabled: 0 | 1;
  created_by: "user";
  note: string | null;
  created_at: string;
}

const columns = `
  id, persona_id, revision_number, instructions, is_enabled, created_by,
  note, created_at
`;

function mapProfile(row: PersonaBehaviorProfileRow): PersonaBehaviorProfile {
  return {
    id: row.id,
    personaId: row.persona_id,
    revisionNumber: row.revision_number,
    instructions: row.instructions,
    enabled: row.is_enabled === 1,
    createdBy: row.created_by,
    note: row.note,
    createdAt: row.created_at,
  };
}

function requiredPreservedText(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return value;
}

function optionalNote(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export class SqliteContinuityPersonaBehaviorRepository
  implements ContinuityPersonaBehaviorRepository
{
  public constructor(private readonly database: Database.Database) {}

  public getCurrentProfile(personaId: string): PersonaBehaviorProfile | null {
    this.requirePersona(personaId);
    const row = this.database
      .prepare(
        `SELECT ${columns}
         FROM continuity_persona_behavior_profiles
         WHERE persona_id = ?
         ORDER BY revision_number DESC
         LIMIT 1`,
      )
      .get(personaId) as PersonaBehaviorProfileRow | undefined;
    return row === undefined ? null : mapProfile(row);
  }

  public listProfileHistory(personaId: string): PersonaBehaviorProfile[] {
    this.requirePersona(personaId);
    const rows = this.database
      .prepare(
        `SELECT ${columns}
         FROM continuity_persona_behavior_profiles
         WHERE persona_id = ?
         ORDER BY revision_number`,
      )
      .all(personaId) as PersonaBehaviorProfileRow[];
    return rows.map(mapProfile);
  }

  public appendProfile(
    input: ConfigurePersonaBehaviorProfileInput,
    actor: "user",
  ): PersonaBehaviorProfile {
    const personaId = input.personaId.trim();
    if (personaId.length === 0) {
      throw new Error("personaId must not be empty.");
    }
    const instructions = requiredPreservedText(input.instructions, "instructions");
    let storedId = "";
    const append = this.database.transaction(() => {
      const current = this.getCurrentProfile(personaId);
      const currentRevision = current?.revisionNumber ?? null;
      if (input.expectedRevisionNumber !== currentRevision) {
        throw new Error(
          `Persona behavior changed from revision ${String(input.expectedRevisionNumber)} to ${String(currentRevision)}; review it and try again.`,
        );
      }
      storedId = randomUUID();
      this.database
        .prepare(
          `INSERT INTO continuity_persona_behavior_profiles (
             id, persona_id, revision_number, instructions, is_enabled,
             created_by, note
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          storedId,
          personaId,
          (currentRevision ?? 0) + 1,
          instructions,
          input.enabled ? 1 : 0,
          actor,
          optionalNote(input.note),
        );
    });
    append();
    const profile = this.getCurrentProfile(personaId);
    if (profile === null || profile.id !== storedId) {
      throw new Error("The persona behavior profile was not stored.");
    }
    return profile;
  }

  private requirePersona(personaId: string): void {
    const persona = this.database
      .prepare("SELECT 1 AS present FROM continuity_personas WHERE id = ?")
      .get(personaId);
    if (persona === undefined) {
      throw new Error(`Persona not found: ${personaId}`);
    }
  }
}

