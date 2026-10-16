PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_persona_behavior_profiles (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL REFERENCES continuity_personas(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    instructions TEXT NOT NULL CHECK (length(trim(instructions)) > 0),
    is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
    created_by TEXT NOT NULL CHECK (created_by = 'user'),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (persona_id, revision_number)
) STRICT;

CREATE INDEX continuity_persona_behavior_profiles_persona_idx
    ON continuity_persona_behavior_profiles(persona_id, revision_number DESC);

CREATE TRIGGER continuity_persona_behavior_revision_sequence
BEFORE INSERT ON continuity_persona_behavior_profiles
WHEN NEW.revision_number <> COALESCE(
    (SELECT MAX(revision_number) + 1
     FROM continuity_persona_behavior_profiles
     WHERE persona_id = NEW.persona_id),
    1
)
BEGIN
    SELECT RAISE(ABORT, 'Persona behavior revisions must be sequential');
END;

CREATE TRIGGER continuity_persona_behavior_immutable
BEFORE UPDATE ON continuity_persona_behavior_profiles
BEGIN
    SELECT RAISE(ABORT, 'Persona behavior revisions cannot be changed');
END;

CREATE TRIGGER continuity_persona_behavior_delete_protected
BEFORE DELETE ON continuity_persona_behavior_profiles
BEGIN
    SELECT RAISE(ABORT, 'Persona behavior revisions cannot be deleted');
END;

ALTER TABLE continuity_conversations
    ADD COLUMN behavior_profile_id TEXT
        REFERENCES continuity_persona_behavior_profiles(id) ON DELETE RESTRICT;

ALTER TABLE continuity_conversations
    ADD COLUMN behavior_profile_revision INTEGER
        CHECK (behavior_profile_revision IS NULL OR behavior_profile_revision > 0);

CREATE TRIGGER continuity_conversation_behavior_insert
BEFORE INSERT ON continuity_conversations
WHEN
    (NEW.behavior_profile_id IS NULL) <> (NEW.behavior_profile_revision IS NULL)
    OR (
        NEW.behavior_profile_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM continuity_persona_behavior_profiles profile
            WHERE profile.id = NEW.behavior_profile_id
              AND profile.persona_id = NEW.persona_id
              AND profile.revision_number = NEW.behavior_profile_revision
              AND profile.is_enabled = 1
        )
    )
BEGIN
    SELECT RAISE(ABORT, 'Continuity conversation behavior does not match its persona');
END;

INSERT INTO schema_migrations(version, name)
VALUES (19, 'persona_behavior_profiles_v0.9');

COMMIT;

