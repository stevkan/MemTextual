PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE continuity_ranking_profiles
    ADD COLUMN emotional_weight REAL NOT NULL DEFAULT 0.0
        CHECK (emotional_weight >= 0.0 AND emotional_weight <= 1.0);

CREATE TABLE continuity_emotional_profiles (
    id TEXT PRIMARY KEY,
    memory_revision_id TEXT NOT NULL
        REFERENCES memory_revisions(id) ON DELETE CASCADE,
    persona_id TEXT NOT NULL
        REFERENCES continuity_personas(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    valence REAL NOT NULL CHECK (valence >= -1.0 AND valence <= 1.0),
    activation REAL NOT NULL CHECK (activation >= 0.0 AND activation <= 1.0),
    salience REAL NOT NULL CHECK (salience >= 0.0 AND salience <= 1.0),
    created_by TEXT NOT NULL CHECK (created_by = 'user'),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (memory_revision_id, revision_number)
) STRICT;

CREATE INDEX continuity_emotional_profiles_revision_idx
    ON continuity_emotional_profiles(memory_revision_id, revision_number DESC);

CREATE INDEX continuity_emotional_profiles_persona_idx
    ON continuity_emotional_profiles(persona_id, created_at DESC);

CREATE TRIGGER continuity_emotional_profile_scope_insert
BEFORE INSERT ON continuity_emotional_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM memory_revisions revision
    JOIN memory_items memory
      ON memory.id = revision.memory_id
     AND memory.current_revision_id = revision.id
     AND memory.status <> 'deleted'
    JOIN continuity_memory_profiles profile ON profile.memory_id = memory.id
    WHERE revision.id = NEW.memory_revision_id
      AND profile.persona_id = NEW.persona_id
)
BEGIN
    SELECT RAISE(ABORT, 'Emotional profile must target a retained current persona-memory revision');
END;

CREATE TRIGGER continuity_emotional_profile_revision_sequence
BEFORE INSERT ON continuity_emotional_profiles
WHEN NEW.revision_number <> COALESCE(
    (SELECT MAX(revision_number) + 1
     FROM continuity_emotional_profiles
     WHERE memory_revision_id = NEW.memory_revision_id),
    1
)
BEGIN
    SELECT RAISE(ABORT, 'Emotional profile revisions must be sequential');
END;

CREATE TRIGGER continuity_emotional_profile_immutable
BEFORE UPDATE ON continuity_emotional_profiles
BEGIN
    SELECT RAISE(ABORT, 'Emotional profile revisions cannot be changed');
END;

INSERT INTO schema_migrations(version, name)
VALUES (16, 'emotional_relevance_v0.9');

COMMIT;
