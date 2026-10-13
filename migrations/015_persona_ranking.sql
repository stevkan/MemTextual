PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_ranking_profiles (
    id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL REFERENCES continuity_personas(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    lexical_weight REAL NOT NULL CHECK (lexical_weight >= 0.0 AND lexical_weight <= 1.0),
    semantic_weight REAL NOT NULL CHECK (semantic_weight >= 0.0 AND semantic_weight <= 1.0),
    pinned_boost REAL NOT NULL CHECK (pinned_boost >= 0.0 AND pinned_boost <= 1.0),
    explicit_boost REAL NOT NULL CHECK (explicit_boost >= 0.0 AND explicit_boost <= 1.0),
    episodic_boost REAL NOT NULL CHECK (episodic_boost >= 0.0 AND episodic_boost <= 1.0),
    durable_boost REAL NOT NULL CHECK (durable_boost >= 0.0 AND durable_boost <= 1.0),
    created_by TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (lexical_weight + semantic_weight > 0.0),
    UNIQUE (persona_id, revision_number)
) STRICT;

CREATE INDEX continuity_ranking_profiles_persona_idx
    ON continuity_ranking_profiles(persona_id, revision_number DESC);

INSERT INTO continuity_ranking_profiles (
    id, persona_id, revision_number, lexical_weight, semantic_weight,
    pinned_boost, explicit_boost, episodic_boost, durable_boost,
    created_by, note
)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random() % 4) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    persona.id, 1, 0.35, 0.65, 0.15, 0.05, 0.0, 0.0,
    'system', 'Default persona ranking profile.'
FROM continuity_personas persona;

CREATE TRIGGER continuity_ranking_profile_default
AFTER INSERT ON continuity_personas
BEGIN
    INSERT INTO continuity_ranking_profiles (
        id, persona_id, revision_number, lexical_weight, semantic_weight,
        pinned_boost, explicit_boost, episodic_boost, durable_boost,
        created_by, note
    ) VALUES (
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
        substr(lower(hex(randomblob(2))), 2) || '-' ||
        substr('89ab', abs(random() % 4) + 1, 1) ||
        substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
        NEW.id, 1, 0.35, 0.65, 0.15, 0.05, 0.0, 0.0,
        'system', 'Default persona ranking profile.'
    );
END;

CREATE TRIGGER continuity_ranking_profile_revision_sequence
BEFORE INSERT ON continuity_ranking_profiles
WHEN NEW.revision_number <> COALESCE(
    (SELECT MAX(revision_number) + 1
     FROM continuity_ranking_profiles
     WHERE persona_id = NEW.persona_id),
    1
)
BEGIN
    SELECT RAISE(ABORT, 'Ranking profile revisions must be sequential');
END;

CREATE TRIGGER continuity_ranking_profile_immutable
BEFORE UPDATE ON continuity_ranking_profiles
BEGIN
    SELECT RAISE(ABORT, 'Ranking profile revisions cannot be changed');
END;

CREATE TRIGGER continuity_ranking_profile_delete_protected
BEFORE DELETE ON continuity_ranking_profiles
BEGIN
    SELECT RAISE(ABORT, 'Ranking profile revisions cannot be deleted');
END;

INSERT INTO schema_migrations(version, name)
VALUES (15, 'persona_ranking_v0.9');

COMMIT;
