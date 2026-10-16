PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL REFERENCES continuity_relationships(id) ON DELETE RESTRICT,
    authorization_id TEXT NOT NULL
        REFERENCES continuity_host_authorizations(id) ON DELETE RESTRICT,
    host_id TEXT NOT NULL CHECK (length(trim(host_id)) BETWEEN 1 AND 200),
    external_conversation_id TEXT NOT NULL CHECK (
        length(trim(external_conversation_id)) BETWEEN 1 AND 500
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (host_id, external_conversation_id),
    FOREIGN KEY (persona_id, user_id)
        REFERENCES continuity_personas(id, user_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX continuity_conversations_persona_idx
    ON continuity_conversations(persona_id, created_at, id);

CREATE TRIGGER continuity_conversation_context_insert
BEFORE INSERT ON continuity_conversations
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_relationships relationship
    JOIN continuity_host_authorizations authorization
      ON authorization.id = NEW.authorization_id
    WHERE relationship.id = NEW.relationship_id
      AND relationship.user_id = NEW.user_id
      AND relationship.persona_id = NEW.persona_id
      AND authorization.user_id = NEW.user_id
      AND authorization.persona_id = NEW.persona_id
      AND authorization.relationship_id = NEW.relationship_id
      AND authorization.host_id = NEW.host_id
)
BEGIN
    SELECT RAISE(ABORT, 'Continuity conversation context does not match its authorization');
END;

CREATE TRIGGER continuity_conversation_immutable
BEFORE UPDATE ON continuity_conversations
BEGIN
    SELECT RAISE(ABORT, 'Continuity conversation binding cannot be changed');
END;

INSERT INTO schema_migrations(version, name)
VALUES (17, 'continuity_conversations_v0.9');

COMMIT;
