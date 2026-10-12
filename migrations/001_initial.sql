PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('chat', 'file', 'manual', 'app', 'api')),
    title TEXT,
    origin_uri TEXT,
    external_id TEXT,
    content_hash TEXT,
    captured_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT,
    UNIQUE (source_kind, external_id)
) STRICT;

CREATE TABLE source_records (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    record_kind TEXT NOT NULL DEFAULT 'message' CHECK (record_kind IN ('message', 'section', 'entry', 'event', 'other')),
    author_role TEXT,
    author_name TEXT,
    content TEXT NOT NULL,
    content_hash TEXT,
    occurred_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT,
    UNIQUE (source_id, ordinal)
) STRICT;

CREATE TABLE scopes (
    id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'project', 'conversation', 'namespace')),
    name TEXT NOT NULL,
    external_key TEXT,
    parent_scope_id TEXT REFERENCES scopes(id) ON DELETE RESTRICT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (scope_kind, external_key),
    CHECK (parent_scope_id IS NULL OR parent_scope_id <> id)
) STRICT;

CREATE TABLE memory_items (
    id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL CHECK (memory_type IN (
        'preference', 'fact', 'decision', 'entity', 'task_context',
        'instruction', 'goal', 'relationship', 'other'
    )),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'superseded', 'contradicted', 'archived', 'deleted'
    )),
    current_revision_id TEXT REFERENCES memory_revisions(id) ON DELETE RESTRICT,
    retrieval_policy TEXT NOT NULL DEFAULT 'include' CHECK (retrieval_policy IN ('include', 'exclude', 'manual')),
    sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
    last_used_at TEXT,
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    archived_at TEXT,
    deleted_at TEXT,
    deletion_reason TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
    CHECK ((status = 'archived') = (archived_at IS NOT NULL))
) STRICT;

CREATE TABLE memory_revisions (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    assertion TEXT NOT NULL CHECK (length(trim(assertion)) > 0),
    normalized_assertion TEXT,
    explicitness TEXT NOT NULL CHECK (explicitness IN ('explicit', 'inferred')),
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    change_kind TEXT NOT NULL CHECK (change_kind IN ('created', 'edited', 'reaffirmed', 'corrected', 'superseded')),
    previous_revision_id TEXT REFERENCES memory_revisions(id) ON DELETE RESTRICT,
    observed_at TEXT,
    valid_from TEXT,
    valid_to TEXT,
    created_by TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('user', 'extractor', 'system', 'import')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    UNIQUE (memory_id, revision_number),
    CHECK (previous_revision_id IS NULL OR previous_revision_id <> id),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
) STRICT;

CREATE TABLE memory_evidence (
    memory_revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    evidence_role TEXT NOT NULL DEFAULT 'supports' CHECK (evidence_role IN ('supports', 'contradicts', 'context')),
    excerpt TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (memory_revision_id, source_record_id, evidence_role)
) STRICT;

CREATE TABLE memory_scopes (
    memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE RESTRICT,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (memory_id, scope_id)
) STRICT;

CREATE UNIQUE INDEX one_primary_scope_per_memory
    ON memory_scopes(memory_id)
    WHERE is_primary = 1;

CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'organization', 'project', 'product', 'place', 'concept', 'other')),
    canonical_name TEXT NOT NULL COLLATE NOCASE,
    description TEXT,
    external_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (entity_type, canonical_name),
    UNIQUE (entity_type, external_key)
) STRICT;

CREATE TABLE entity_aliases (
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (entity_id, alias)
) STRICT;

CREATE TABLE memory_entities (
    memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_role TEXT NOT NULL DEFAULT 'subject' CHECK (entity_role IN ('subject', 'object', 'context', 'owner')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (memory_id, entity_id, entity_role)
) STRICT;

CREATE TABLE memory_relations (
    from_memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    to_memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'relates_to', 'supersedes', 'contradicts', 'refines', 'depends_on', 'duplicate_of'
    )),
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_by TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('user', 'extractor', 'system', 'import')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    PRIMARY KEY (from_memory_id, to_memory_id, relation_type),
    CHECK (from_memory_id <> to_memory_id)
) STRICT;

CREATE TABLE memory_search_documents (
    memory_id TEXT NOT NULL UNIQUE REFERENCES memory_items(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL UNIQUE REFERENCES memory_revisions(id) ON DELETE CASCADE,
    search_text TEXT NOT NULL CHECK (length(trim(search_text)) > 0),
    content_hash TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE VIRTUAL TABLE memory_search_fts USING fts5(
    search_text,
    content = 'memory_search_documents',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER memory_search_documents_ai AFTER INSERT ON memory_search_documents BEGIN
    INSERT INTO memory_search_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER memory_search_documents_ad AFTER DELETE ON memory_search_documents BEGIN
    INSERT INTO memory_search_fts(memory_search_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER memory_search_documents_au AFTER UPDATE ON memory_search_documents BEGIN
    INSERT INTO memory_search_fts(memory_search_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
    INSERT INTO memory_search_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TABLE memory_embeddings (
    id TEXT PRIMARY KEY,
    memory_revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK (dimensions > 0),
    vector_ref TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (memory_revision_id, provider, model)
) STRICT;

CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'revised', 'retrieved', 'pinned', 'unpinned', 'protected',
        'unprotected', 'superseded', 'contradicted', 'archived', 'restored',
        'deleted', 'purged', 'scope_changed'
    )),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'extractor', 'system', 'import', 'client')),
    actor_id TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX source_records_source_idx ON source_records(source_id, ordinal);
CREATE INDEX memory_items_status_type_idx ON memory_items(status, memory_type);
CREATE INDEX memory_items_retrieval_idx ON memory_items(retrieval_policy, sensitivity, is_pinned);
CREATE INDEX memory_revisions_memory_idx ON memory_revisions(memory_id, revision_number DESC);
CREATE INDEX memory_evidence_source_idx ON memory_evidence(source_record_id);
CREATE INDEX memory_scopes_scope_idx ON memory_scopes(scope_id, memory_id);
CREATE INDEX memory_entities_entity_idx ON memory_entities(entity_id, memory_id);
CREATE INDEX memory_relations_to_idx ON memory_relations(to_memory_id, relation_type);
CREATE INDEX audit_events_memory_time_idx ON audit_events(memory_id, occurred_at DESC);

CREATE TRIGGER current_revision_belongs_to_memory_insert
BEFORE INSERT ON memory_items
WHEN new.current_revision_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM memory_revisions r
        WHERE r.id = new.current_revision_id AND r.memory_id = new.id
    ) THEN RAISE(ABORT, 'current revision must belong to memory item') END;
END;

CREATE TRIGGER current_revision_belongs_to_memory_update
BEFORE UPDATE OF current_revision_id ON memory_items
WHEN new.current_revision_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM memory_revisions r
        WHERE r.id = new.current_revision_id AND r.memory_id = new.id
    ) THEN RAISE(ABORT, 'current revision must belong to memory item') END;
END;

CREATE TRIGGER previous_revision_belongs_to_memory
BEFORE INSERT ON memory_revisions
WHEN new.previous_revision_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM memory_revisions r
        WHERE r.id = new.previous_revision_id AND r.memory_id = new.memory_id
    ) THEN RAISE(ABORT, 'previous revision must belong to same memory item') END;
END;

INSERT INTO schema_migrations(version, name) VALUES (1, 'initial_schema_v0.1');

COMMIT;
