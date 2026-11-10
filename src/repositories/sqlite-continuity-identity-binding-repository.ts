import type Database from "better-sqlite3";
import type {
  ContinuityIdentityBinding,
  ContinuityIdentityBindingStatus,
} from "../domain/continuity-identity.js";
import type {
  ContinuityIdentityBindingRepository,
  CreateContinuityIdentityBindingRecordInput,
} from "./continuity-identity-binding-repository.js";

interface IdentityBindingRow {
  id: string;
  identity_hash: string;
  issuer: string;
  user_id: string;
  status: ContinuityIdentityBindingStatus;
  authorized_at: string;
  revoked_at: string | null;
}

const identityBindingColumns = `
  id, identity_hash, issuer, user_id, status, authorized_at, revoked_at
`;

function mapBinding(row: IdentityBindingRow): ContinuityIdentityBinding {
  return {
    id: row.id,
    identityHash: row.identity_hash,
    issuer: row.issuer,
    userId: row.user_id,
    status: row.status,
    authorizedAt: row.authorized_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteContinuityIdentityBindingRepository
  implements ContinuityIdentityBindingRepository
{
  public constructor(private readonly database: Database.Database) {}

  public createBinding(
    input: CreateContinuityIdentityBindingRecordInput,
  ): ContinuityIdentityBinding {
    this.database
      .prepare(
        `INSERT INTO continuity_identity_bindings (
           id, identity_hash, issuer, user_id
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(input.id, input.identityHash, input.issuer, input.userId);
    return this.requireBinding(input.id);
  }

  public getBindingByIdentityHash(
    identityHash: string,
  ): ContinuityIdentityBinding | null {
    const row = this.database
      .prepare(
        `SELECT ${identityBindingColumns}
         FROM continuity_identity_bindings
         WHERE identity_hash = ?`,
      )
      .get(identityHash) as IdentityBindingRow | undefined;
    return row === undefined ? null : mapBinding(row);
  }

  public listBindings(
    userId: string,
    includeRevoked = false,
  ): ContinuityIdentityBinding[] {
    return (
      this.database
        .prepare(
          `SELECT ${identityBindingColumns}
           FROM continuity_identity_bindings
           WHERE user_id = ? AND (? = 1 OR status = 'active')
           ORDER BY authorized_at, id`,
        )
        .all(userId, includeRevoked ? 1 : 0) as IdentityBindingRow[]
    ).map(mapBinding);
  }

  public revokeBinding(id: string): ContinuityIdentityBinding {
    const result = this.database
      .prepare(
        `UPDATE continuity_identity_bindings
         SET status = 'revoked',
             revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'active'`,
      )
      .run(id);
    if (result.changes !== 1) {
      throw new Error(`Active Continuity identity binding not found: ${id}`);
    }
    return this.requireBinding(id);
  }

  private requireBinding(id: string): ContinuityIdentityBinding {
    const row = this.database
      .prepare(
        `SELECT ${identityBindingColumns}
         FROM continuity_identity_bindings
         WHERE id = ?`,
      )
      .get(id) as IdentityBindingRow | undefined;
    if (row === undefined) {
      throw new Error(`Continuity identity binding not found: ${id}`);
    }
    return mapBinding(row);
  }
}
