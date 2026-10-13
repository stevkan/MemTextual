import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ContinuityUser,
  CreateContinuityUserInput,
  CreatePersonaInput,
  Persona,
  PersonaContext,
  PersonaMetadata,
  PersonaRelationship,
} from "../domain/persona.js";
import type { PersonaRepository } from "./persona-repository.js";

interface UserRow {
  id: string;
  display_name: string;
  external_id: string | null;
  scope_id: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface PersonaRow {
  id: string;
  user_id: string;
  name: string;
  external_id: string | null;
  description: string | null;
  scope_id: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface RelationshipRow {
  id: string;
  user_id: string;
  persona_id: string;
  name: string;
  scope_id: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function metadataJson(metadata: PersonaMetadata | undefined): string {
  const value = metadata ?? {};
  if (Array.isArray(value) || value === null) {
    throw new Error("Persona metadata must be an object.");
  }
  return JSON.stringify(value);
}

function parseMetadata(value: string): PersonaMetadata {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored persona metadata is not an object.");
  }
  return parsed as PersonaMetadata;
}

function mapUser(row: UserRow): ContinuityUser {
  return {
    id: row.id,
    displayName: row.display_name,
    externalId: row.external_id,
    scopeId: row.scope_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    externalId: row.external_id,
    description: row.description,
    scopeId: row.scope_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: RelationshipRow): PersonaRelationship {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    name: row.name,
    scopeId: row.scope_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqlitePersonaRepository implements PersonaRepository {
  public constructor(private readonly database: Database.Database) {}

  public createUser(input: CreateContinuityUserInput): ContinuityUser {
    const displayName = requiredText(input.displayName, "A user display name");
    const externalId = optionalText(input.externalId);
    const metadata = metadataJson(input.metadata);
    const userId = randomUUID();
    const scopeId = randomUUID();

    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO scopes (
             id, scope_kind, name, external_key
           ) VALUES (?, 'namespace', ?, ?)`,
        )
        .run(scopeId, `${displayName} (Continuity user)`, `continuity:user:${userId}`);
      this.database
        .prepare(
          `INSERT INTO continuity_users (
             id, display_name, external_id, scope_id, metadata_json
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, displayName, externalId, scopeId, metadata);
    });
    create();
    return this.requireUser(userId);
  }

  public getUser(id: string): ContinuityUser | null {
    const row = this.database
      .prepare(
        `SELECT
           id, display_name, external_id, scope_id, metadata_json,
           created_at, updated_at
         FROM continuity_users
         WHERE id = ?`,
      )
      .get(id) as UserRow | undefined;
    return row === undefined ? null : mapUser(row);
  }

  public listUsers(): ContinuityUser[] {
    const rows = this.database
      .prepare(
        `SELECT
           id, display_name, external_id, scope_id, metadata_json,
           created_at, updated_at
         FROM continuity_users
         ORDER BY display_name COLLATE NOCASE, id`,
      )
      .all() as UserRow[];
    return rows.map(mapUser);
  }

  public createPersona(input: CreatePersonaInput): PersonaContext {
    const name = requiredText(input.name, "A persona name");
    const externalId = optionalText(input.externalId);
    const description = optionalText(input.description);
    const relationshipName =
      optionalText(input.relationshipName) ?? `Relationship with ${name}`;
    const personaMetadata = metadataJson(input.personaMetadata);
    const relationshipMetadata = metadataJson(input.relationshipMetadata);
    const personaId = randomUUID();
    const personaScopeId = randomUUID();
    const relationshipId = randomUUID();
    const relationshipScopeId = randomUUID();

    const create = this.database.transaction(() => {
      const user = this.requireUser(input.userId);
      this.database
        .prepare(
          `INSERT INTO scopes (
             id, scope_kind, name, external_key, parent_scope_id
           ) VALUES (?, 'namespace', ?, ?, ?)`,
        )
        .run(
          personaScopeId,
          `${name} (persona)`,
          `continuity:persona:${personaId}`,
          user.scopeId,
        );
      this.database
        .prepare(
          `INSERT INTO continuity_personas (
             id, user_id, name, external_id, description, scope_id, metadata_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          personaId,
          user.id,
          name,
          externalId,
          description,
          personaScopeId,
          personaMetadata,
        );
      this.database
        .prepare(
          `INSERT INTO scopes (
             id, scope_kind, name, external_key, parent_scope_id
           ) VALUES (?, 'namespace', ?, ?, ?)`,
        )
        .run(
          relationshipScopeId,
          relationshipName,
          `continuity:relationship:${relationshipId}`,
          personaScopeId,
        );
      this.database
        .prepare(
          `INSERT INTO continuity_relationships (
             id, user_id, persona_id, name, scope_id, metadata_json
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          relationshipId,
          user.id,
          personaId,
          relationshipName,
          relationshipScopeId,
          relationshipMetadata,
        );
    });
    create();
    return this.requirePersonaContext(personaId);
  }

  public getPersonaContext(id: string): PersonaContext | null {
    const persona = this.database
      .prepare(
        `SELECT
           id, user_id, name, external_id, description, scope_id,
           metadata_json, created_at, updated_at
         FROM continuity_personas
         WHERE id = ?`,
      )
      .get(id) as PersonaRow | undefined;
    if (persona === undefined) {
      return null;
    }
    const relationship = this.database
      .prepare(
        `SELECT
           id, user_id, persona_id, name, scope_id, metadata_json,
           created_at, updated_at
         FROM continuity_relationships
         WHERE persona_id = ?`,
      )
      .get(id) as RelationshipRow | undefined;
    if (relationship === undefined) {
      throw new Error(`Persona ${id} has no relationship context.`);
    }
    return {
      persona: mapPersona(persona),
      relationship: mapRelationship(relationship),
    };
  }

  public listPersonas(userId: string): PersonaContext[] {
    this.requireUser(userId);
    const ids = this.database
      .prepare(
        `SELECT id
         FROM continuity_personas
         WHERE user_id = ?
         ORDER BY name COLLATE NOCASE, id`,
      )
      .all(userId) as Array<{ id: string }>;
    return ids.map(({ id }) => this.requirePersonaContext(id));
  }

  private requireUser(id: string): ContinuityUser {
    const user = this.getUser(id);
    if (user === null) {
      throw new Error(`Continuity user not found: ${id}`);
    }
    return user;
  }

  private requirePersonaContext(id: string): PersonaContext {
    const context = this.getPersonaContext(id);
    if (context === null) {
      throw new Error(`Persona not found: ${id}`);
    }
    return context;
  }
}
