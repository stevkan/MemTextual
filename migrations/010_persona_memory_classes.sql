PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_memory_profiles (
    memory_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL REFERENCES continuity_relationships(id) ON DELETE RESTRICT,
    memory_class TEXT NOT NULL CHECK (memory_class IN ('episodic', 'durable')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (persona_id, user_id)
        REFERENCES continuity_personas(id, user_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX continuity_memory_profiles_persona_idx
    ON continuity_memory_profiles(persona_id, memory_class, memory_id);

CREATE TRIGGER continuity_memory_profile_context_insert
BEFORE INSERT ON continuity_memory_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_relationships relationship
    WHERE relationship.id = NEW.relationship_id
      AND relationship.user_id = NEW.user_id
      AND relationship.persona_id = NEW.persona_id
)
BEGIN
    SELECT RAISE(ABORT, 'Persona memory relationship does not match its owner');
END;

CREATE TRIGGER continuity_memory_profile_scope_insert
BEFORE INSERT ON continuity_memory_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_relationships relationship
    JOIN memory_scopes binding
      ON binding.memory_id = NEW.memory_id
     AND binding.scope_id = relationship.scope_id
     AND binding.is_primary = 1
    JOIN memory_items memory
      ON memory.id = binding.memory_id
     AND memory.status = 'active'
    WHERE relationship.id = NEW.relationship_id
)
OR EXISTS (
    SELECT 1
    FROM memory_scopes binding
    JOIN continuity_relationships relationship ON relationship.id = NEW.relationship_id
    WHERE binding.memory_id = NEW.memory_id
      AND binding.scope_id <> relationship.scope_id
)
BEGIN
    SELECT RAISE(ABORT, 'Persona memory must use only its relationship scope');
END;

CREATE TRIGGER continuity_profiled_memory_scope_insert
BEFORE INSERT ON memory_scopes
WHEN EXISTS (
    SELECT 1
    FROM continuity_memory_profiles profile
    JOIN continuity_relationships relationship
      ON relationship.id = profile.relationship_id
    WHERE profile.memory_id = NEW.memory_id
      AND relationship.scope_id <> NEW.scope_id
)
BEGIN
    SELECT RAISE(ABORT, 'A persona memory cannot cross relationship scopes');
END;

CREATE TRIGGER continuity_profiled_memory_scope_update
BEFORE UPDATE OF scope_id ON memory_scopes
WHEN EXISTS (
    SELECT 1
    FROM continuity_memory_profiles profile
    JOIN continuity_relationships relationship
      ON relationship.id = profile.relationship_id
    WHERE profile.memory_id = OLD.memory_id
      AND relationship.scope_id <> NEW.scope_id
)
BEGIN
    SELECT RAISE(ABORT, 'A persona memory cannot cross relationship scopes');
END;

CREATE TRIGGER continuity_profiled_memory_binding_identity_update
BEFORE UPDATE OF memory_id ON memory_scopes
WHEN EXISTS (
    SELECT 1 FROM continuity_memory_profiles WHERE memory_id = OLD.memory_id
)
OR EXISTS (
    SELECT 1 FROM continuity_memory_profiles WHERE memory_id = NEW.memory_id
)
BEGIN
    SELECT RAISE(ABORT, 'A persona memory scope binding cannot be reassigned');
END;

CREATE TRIGGER continuity_profiled_memory_primary_update
BEFORE UPDATE OF is_primary ON memory_scopes
WHEN NEW.is_primary <> 1
AND EXISTS (
    SELECT 1 FROM continuity_memory_profiles WHERE memory_id = OLD.memory_id
)
BEGIN
    SELECT RAISE(ABORT, 'A persona relationship scope must remain primary');
END;

CREATE TRIGGER continuity_profiled_memory_scope_delete
BEFORE DELETE ON memory_scopes
WHEN EXISTS (
    SELECT 1
    FROM continuity_memory_profiles profile
    JOIN memory_items memory ON memory.id = profile.memory_id
    WHERE profile.memory_id = OLD.memory_id
      AND memory.status <> 'deleted'
)
BEGIN
    SELECT RAISE(ABORT, 'An active persona memory must retain its relationship scope');
END;

CREATE TRIGGER continuity_memory_profile_identity_immutable
BEFORE UPDATE OF memory_id, user_id, persona_id, relationship_id
ON continuity_memory_profiles
BEGIN
    SELECT RAISE(ABORT, 'Persona memory ownership cannot be changed');
END;

INSERT INTO schema_migrations(version, name)
VALUES (10, 'persona_memory_classes_v0.9');

COMMIT;
