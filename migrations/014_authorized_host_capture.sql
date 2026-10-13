PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_host_authorizations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL REFERENCES continuity_relationships(id) ON DELETE RESTRICT,
    host_id TEXT NOT NULL CHECK (length(trim(host_id)) BETWEEN 1 AND 200),
    grant_hash TEXT NOT NULL UNIQUE CHECK (
        length(grant_hash) = 64
        AND grant_hash = lower(grant_hash)
        AND grant_hash NOT GLOB '*[^0-9a-f]*'
    ),
    allowed_event_kinds_json TEXT NOT NULL CHECK (
        json_valid(allowed_event_kinds_json)
        AND json_type(allowed_event_kinds_json) = 'array'
        AND json_array_length(allowed_event_kinds_json) > 0
    ),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    expires_at TEXT,
    authorized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    revoked_at TEXT,
    FOREIGN KEY (persona_id, user_id)
        REFERENCES continuity_personas(id, user_id) ON DELETE RESTRICT,
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK (expires_at IS NULL OR julianday(expires_at) IS NOT NULL)
) STRICT;

CREATE INDEX continuity_host_authorizations_persona_idx
    ON continuity_host_authorizations(persona_id, status, host_id, authorized_at);

CREATE TRIGGER continuity_host_authorization_context_insert
BEFORE INSERT ON continuity_host_authorizations
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_relationships relationship
    WHERE relationship.id = NEW.relationship_id
      AND relationship.user_id = NEW.user_id
      AND relationship.persona_id = NEW.persona_id
)
BEGIN
    SELECT RAISE(ABORT, 'Host authorization relationship does not match its owner');
END;

CREATE TRIGGER continuity_host_authorization_values_insert
BEFORE INSERT ON continuity_host_authorizations
WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.allowed_event_kinds_json) event_kind
    WHERE event_kind.type <> 'text'
       OR length(trim(event_kind.value)) NOT BETWEEN 1 AND 200
)
OR (
    SELECT count(*) FROM json_each(NEW.allowed_event_kinds_json)
) <> (
    SELECT count(DISTINCT value) FROM json_each(NEW.allowed_event_kinds_json)
)
BEGIN
    SELECT RAISE(ABORT, 'Host authorization event kinds are invalid');
END;

CREATE TRIGGER continuity_host_authorization_identity_immutable
BEFORE UPDATE ON continuity_host_authorizations
WHEN NEW.user_id IS NOT OLD.user_id
 OR NEW.persona_id IS NOT OLD.persona_id
 OR NEW.relationship_id IS NOT OLD.relationship_id
 OR NEW.host_id IS NOT OLD.host_id
 OR NEW.grant_hash IS NOT OLD.grant_hash
 OR NEW.allowed_event_kinds_json IS NOT OLD.allowed_event_kinds_json
 OR NEW.expires_at IS NOT OLD.expires_at
 OR NEW.authorized_at IS NOT OLD.authorized_at
BEGIN
    SELECT RAISE(ABORT, 'Host authorization identity cannot be changed');
END;

CREATE TRIGGER continuity_host_authorization_revoke_only
BEFORE UPDATE OF status, revoked_at ON continuity_host_authorizations
WHEN NOT (
    OLD.status = 'active'
    AND OLD.revoked_at IS NULL
    AND NEW.status = 'revoked'
    AND NEW.revoked_at IS NOT NULL
    AND julianday(NEW.revoked_at) IS NOT NULL
)
BEGIN
    SELECT RAISE(ABORT, 'Host authorization may only transition from active to revoked');
END;

CREATE TABLE continuity_host_events (
    id TEXT PRIMARY KEY,
    authorization_id TEXT NOT NULL
        REFERENCES continuity_host_authorizations(id) ON DELETE RESTRICT,
    external_event_id TEXT NOT NULL CHECK (
        length(trim(external_event_id)) BETWEEN 1 AND 500
    ),
    event_kind TEXT NOT NULL CHECK (length(trim(event_kind)) BETWEEN 1 AND 200),
    host_id TEXT NOT NULL CHECK (length(trim(host_id)) BETWEEN 1 AND 200),
    host_version TEXT NOT NULL CHECK (length(trim(host_version)) BETWEEN 1 AND 200),
    persona_id TEXT NOT NULL REFERENCES continuity_personas(id) ON DELETE RESTRICT,
    relationship_id TEXT NOT NULL
        REFERENCES continuity_relationships(id) ON DELETE RESTRICT,
    payload_hash TEXT NOT NULL CHECK (
        length(payload_hash) = 64
        AND payload_hash = lower(payload_hash)
        AND payload_hash NOT GLOB '*[^0-9a-f]*'
    ),
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    candidate_ids_json TEXT NOT NULL CHECK (
        json_valid(candidate_ids_json)
        AND json_type(candidate_ids_json) = 'array'
    ),
    captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (authorization_id, external_event_id)
) STRICT;

CREATE INDEX continuity_host_events_persona_idx
    ON continuity_host_events(persona_id, captured_at, id);

CREATE INDEX continuity_host_events_source_idx
    ON continuity_host_events(source_id, id);

CREATE TRIGGER continuity_host_event_authorization_insert
BEFORE INSERT ON continuity_host_events
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_host_authorizations authorization
    WHERE authorization.id = NEW.authorization_id
      AND authorization.status = 'active'
      AND authorization.user_id = (
          SELECT persona.user_id
          FROM continuity_personas persona
          WHERE persona.id = NEW.persona_id
      )
      AND authorization.persona_id = NEW.persona_id
      AND authorization.relationship_id = NEW.relationship_id
      AND authorization.host_id = NEW.host_id
      AND (
          authorization.expires_at IS NULL
          OR julianday(authorization.expires_at) >= julianday(NEW.captured_at)
      )
      AND EXISTS (
          SELECT 1
          FROM json_each(authorization.allowed_event_kinds_json) allowed
          WHERE allowed.type = 'text' AND allowed.value = NEW.event_kind
      )
)
BEGIN
    SELECT RAISE(ABORT, 'Host event is not covered by an active authorization');
END;

CREATE TRIGGER continuity_host_event_source_insert
BEFORE INSERT ON continuity_host_events
WHEN NOT EXISTS (
    SELECT 1 FROM sources source
    WHERE source.id = NEW.source_id AND source.deleted_at IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'Host event source must be active');
END;

CREATE TRIGGER continuity_host_event_candidates_insert
BEFORE INSERT ON continuity_host_events
WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.candidate_ids_json) candidate
    WHERE candidate.type <> 'text'
       OR NOT EXISTS (
           SELECT 1
           FROM ambient_candidate_profiles profile
           WHERE profile.candidate_id = candidate.value
             AND profile.source_id = NEW.source_id
             AND profile.persona_id = NEW.persona_id
             AND profile.relationship_id = NEW.relationship_id
       )
)
BEGIN
    SELECT RAISE(ABORT, 'Host event candidates must come from its captured source');
END;

CREATE TRIGGER continuity_host_event_immutable
BEFORE UPDATE ON continuity_host_events
BEGIN
    SELECT RAISE(ABORT, 'Host event receipt cannot be changed');
END;

INSERT INTO schema_migrations(version, name)
VALUES (14, 'authorized_host_capture_v0.9');

COMMIT;
