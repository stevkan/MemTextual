import type Database from "better-sqlite3";
import type {
  HostAuthorization,
  HostAuthorizationStatus,
  HostEventReceipt,
} from "../domain/host-event.js";
import type {
  CreateHostAuthorizationRecordInput,
  HostAuthorizationCredential,
  HostEventRepository,
  RecordHostEventInput,
} from "./host-event-repository.js";

interface AuthorizationRow {
  id: string;
  user_id: string;
  persona_id: string;
  relationship_id: string;
  host_id: string;
  grant_hash: string;
  allowed_event_kinds_json: string;
  status: HostAuthorizationStatus;
  expires_at: string | null;
  authorized_at: string;
  revoked_at: string | null;
}

interface HostEventRow {
  id: string;
  authorization_id: string;
  external_event_id: string;
  event_kind: string;
  host_id: string;
  host_version: string;
  persona_id: string;
  relationship_id: string;
  payload_hash: string;
  source_id: string;
  candidate_ids_json: string;
  captured_at: string;
}

const authorizationColumns = `
  id, user_id, persona_id, relationship_id, host_id, grant_hash,
  allowed_event_kinds_json, status, expires_at, authorized_at, revoked_at
`;

const eventColumns = `
  id, authorization_id, external_event_id, event_kind, host_id, host_version,
  persona_id, relationship_id, payload_hash, source_id, candidate_ids_json,
  captured_at
`;

function mapAuthorization(row: AuthorizationRow): HostAuthorization {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    relationshipId: row.relationship_id,
    hostId: row.host_id,
    allowedEventKinds: JSON.parse(row.allowed_event_kinds_json) as string[],
    status: row.status,
    expiresAt: row.expires_at,
    authorizedAt: row.authorized_at,
    revokedAt: row.revoked_at,
  };
}

function mapEvent(row: HostEventRow): HostEventReceipt {
  return {
    id: row.id,
    authorizationId: row.authorization_id,
    externalEventId: row.external_event_id,
    eventKind: row.event_kind,
    hostId: row.host_id,
    hostVersion: row.host_version,
    personaId: row.persona_id,
    relationshipId: row.relationship_id,
    payloadHash: row.payload_hash,
    sourceId: row.source_id,
    candidateIds: JSON.parse(row.candidate_ids_json) as string[],
    capturedAt: row.captured_at,
  };
}

export class SqliteHostEventRepository implements HostEventRepository {
  public constructor(private readonly database: Database.Database) {}

  public createAuthorization(
    input: CreateHostAuthorizationRecordInput,
  ): HostAuthorization {
    this.database
      .prepare(
        `INSERT INTO continuity_host_authorizations (
           id, user_id, persona_id, relationship_id, host_id, grant_hash,
           allowed_event_kinds_json, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.personaId,
        input.relationshipId,
        input.hostId,
        input.grantHash,
        JSON.stringify(input.allowedEventKinds),
        input.expiresAt,
      );
    return this.requireAuthorization(input.id);
  }

  public getAuthorizationCredential(
    id: string,
  ): HostAuthorizationCredential | null {
    const row = this.database
      .prepare(
        `SELECT ${authorizationColumns}
         FROM continuity_host_authorizations WHERE id = ?`,
      )
      .get(id) as AuthorizationRow | undefined;
    return row === undefined
      ? null
      : { authorization: mapAuthorization(row), grantHash: row.grant_hash };
  }

  public listAuthorizations(
    userId: string,
    includeRevoked = false,
  ): HostAuthorization[] {
    return (
      this.database
        .prepare(
          `SELECT ${authorizationColumns}
           FROM continuity_host_authorizations
           WHERE user_id = ? AND (? = 1 OR status = 'active')
           ORDER BY authorized_at, id`,
        )
        .all(userId, includeRevoked ? 1 : 0) as AuthorizationRow[]
    ).map(mapAuthorization);
  }

  public revokeAuthorization(id: string): HostAuthorization {
    const result = this.database
      .prepare(
        `UPDATE continuity_host_authorizations
         SET status = 'revoked',
             revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'active'`,
      )
      .run(id);
    if (result.changes !== 1) {
      throw new Error(`Active host authorization not found: ${id}`);
    }
    return this.requireAuthorization(id);
  }

  public getEvent(
    authorizationId: string,
    externalEventId: string,
  ): HostEventReceipt | null {
    const row = this.database
      .prepare(
        `SELECT ${eventColumns}
         FROM continuity_host_events
         WHERE authorization_id = ? AND external_event_id = ?`,
      )
      .get(authorizationId, externalEventId) as HostEventRow | undefined;
    return row === undefined ? null : mapEvent(row);
  }

  public recordEvent(input: RecordHostEventInput): HostEventReceipt {
    this.database
      .prepare(
        `INSERT INTO continuity_host_events (
           id, authorization_id, external_event_id, event_kind, host_id,
           host_version, persona_id, relationship_id, payload_hash,
           source_id, candidate_ids_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.authorizationId,
        input.externalEventId,
        input.eventKind,
        input.hostId,
        input.hostVersion,
        input.personaId,
        input.relationshipId,
        input.payloadHash,
        input.sourceId,
        JSON.stringify(input.candidateIds),
      );
    const receipt = this.getEvent(input.authorizationId, input.externalEventId);
    if (receipt === null) {
      throw new Error("The host event was recorded but could not be read back.");
    }
    return receipt;
  }

  private requireAuthorization(id: string): HostAuthorization {
    const credential = this.getAuthorizationCredential(id);
    if (credential === null) {
      throw new Error(`Host authorization not found: ${id}`);
    }
    return credential.authorization;
  }
}
