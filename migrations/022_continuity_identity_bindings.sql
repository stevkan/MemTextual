PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_identity_bindings (
    id TEXT PRIMARY KEY,
    identity_hash TEXT NOT NULL UNIQUE CHECK (
        length(identity_hash) = 64
        AND identity_hash = lower(identity_hash)
        AND identity_hash NOT GLOB '*[^0-9a-f]*'
    ),
    issuer TEXT NOT NULL CHECK (length(trim(issuer)) BETWEEN 1 AND 2048),
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    authorized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        CHECK (julianday(authorized_at) IS NOT NULL),
    revoked_at TEXT CHECK (revoked_at IS NULL OR julianday(revoked_at) IS NOT NULL),
    CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
) STRICT;

CREATE INDEX continuity_identity_bindings_user_idx
    ON continuity_identity_bindings(user_id, status, authorized_at);

CREATE TRIGGER continuity_identity_binding_identity_immutable
BEFORE UPDATE OF identity_hash, issuer, user_id, authorized_at
ON continuity_identity_bindings
BEGIN
    SELECT RAISE(ABORT, 'Continuity identity binding ownership cannot be changed');
END;

CREATE TRIGGER continuity_identity_binding_revocation_one_way
BEFORE UPDATE OF status, revoked_at ON continuity_identity_bindings
WHEN OLD.status <> 'active'
  OR OLD.revoked_at IS NOT NULL
  OR NEW.status <> 'revoked'
  OR NEW.revoked_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'Continuity identity binding revocation is one-way');
END;

CREATE TRIGGER continuity_identity_binding_no_delete
BEFORE DELETE ON continuity_identity_bindings
BEGIN
    SELECT RAISE(ABORT, 'Continuity identity bindings cannot be deleted');
END;

INSERT INTO schema_migrations(version, name)
VALUES (22, 'continuity_identity_bindings_v0.9');

COMMIT;
