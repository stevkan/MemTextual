PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    external_id TEXT UNIQUE,
    scope_id TEXT NOT NULL UNIQUE REFERENCES scopes(id) ON DELETE RESTRICT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE continuity_personas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
    external_id TEXT,
    description TEXT,
    scope_id TEXT NOT NULL UNIQUE REFERENCES scopes(id) ON DELETE RESTRICT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (id, user_id),
    UNIQUE (user_id, name),
    UNIQUE (user_id, external_id)
) STRICT;

CREATE INDEX continuity_personas_user_idx
    ON continuity_personas(user_id, name);

CREATE TABLE continuity_relationships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    scope_id TEXT NOT NULL UNIQUE REFERENCES scopes(id) ON DELETE RESTRICT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, persona_id),
    FOREIGN KEY (persona_id, user_id)
        REFERENCES continuity_personas(id, user_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX continuity_relationships_persona_idx
    ON continuity_relationships(persona_id);

CREATE TRIGGER continuity_user_scope_shape_insert
BEFORE INSERT ON continuity_users
WHEN NOT EXISTS (
    SELECT 1 FROM scopes
    WHERE id = NEW.scope_id
      AND scope_kind = 'namespace'
      AND parent_scope_id IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'Continuity user scope must be a root namespace scope');
END;

CREATE TRIGGER continuity_persona_scope_shape_insert
BEFORE INSERT ON continuity_personas
WHEN NOT EXISTS (
    SELECT 1
    FROM scopes persona_scope
    JOIN continuity_users user ON user.id = NEW.user_id
    WHERE persona_scope.id = NEW.scope_id
      AND persona_scope.scope_kind = 'namespace'
      AND persona_scope.parent_scope_id = user.scope_id
)
BEGIN
    SELECT RAISE(ABORT, 'Persona scope must be a namespace child of its user scope');
END;

CREATE TRIGGER continuity_relationship_scope_shape_insert
BEFORE INSERT ON continuity_relationships
WHEN NOT EXISTS (
    SELECT 1
    FROM scopes relationship_scope
    JOIN continuity_personas persona
      ON persona.id = NEW.persona_id AND persona.user_id = NEW.user_id
    WHERE relationship_scope.id = NEW.scope_id
      AND relationship_scope.scope_kind = 'namespace'
      AND relationship_scope.parent_scope_id = persona.scope_id
)
BEGIN
    SELECT RAISE(ABORT, 'Relationship scope must be a namespace child of its persona scope');
END;

CREATE TRIGGER continuity_bound_scope_shape_immutable
BEFORE UPDATE OF scope_kind, parent_scope_id ON scopes
WHEN EXISTS (SELECT 1 FROM continuity_users WHERE scope_id = OLD.id)
  OR EXISTS (SELECT 1 FROM continuity_personas WHERE scope_id = OLD.id)
  OR EXISTS (SELECT 1 FROM continuity_relationships WHERE scope_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'A bound Continuity scope hierarchy cannot be changed');
END;

CREATE TRIGGER continuity_user_scope_immutable
BEFORE UPDATE OF scope_id ON continuity_users
BEGIN
    SELECT RAISE(ABORT, 'A Continuity user scope cannot be changed');
END;

CREATE TRIGGER continuity_persona_identity_immutable
BEFORE UPDATE OF user_id, scope_id ON continuity_personas
BEGIN
    SELECT RAISE(ABORT, 'Persona ownership and scope cannot be changed');
END;

CREATE TRIGGER continuity_relationship_identity_immutable
BEFORE UPDATE OF user_id, persona_id, scope_id ON continuity_relationships
BEGIN
    SELECT RAISE(ABORT, 'Relationship ownership and scope cannot be changed');
END;

INSERT INTO schema_migrations(version, name)
VALUES (9, 'persona_foundations_v0.9');

COMMIT;
