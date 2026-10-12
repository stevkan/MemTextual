BEGIN IMMEDIATE;

CREATE UNIQUE INDEX sources_kind_content_hash_unique
    ON sources(source_kind, content_hash)
    WHERE external_id IS NULL
      AND content_hash IS NOT NULL
      AND deleted_at IS NULL;

CREATE TABLE memory_candidates (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    memory_type TEXT NOT NULL CHECK (memory_type IN (
        'preference', 'fact', 'decision', 'entity', 'task_context',
        'instruction', 'goal', 'relationship', 'other'
    )),
    assertion TEXT NOT NULL CHECK (length(trim(assertion)) > 0),
    normalized_assertion TEXT,
    explicitness TEXT NOT NULL DEFAULT 'explicit'
        CHECK (explicitness IN ('explicit', 'inferred')),
    confidence REAL NOT NULL DEFAULT 1.0
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    observed_at TEXT,
    retrieval_policy TEXT NOT NULL DEFAULT 'include'
        CHECK (retrieval_policy IN ('include', 'exclude', 'manual')),
    sensitivity TEXT NOT NULL DEFAULT 'normal'
        CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE RESTRICT,
    proposed_by TEXT NOT NULL CHECK (proposed_by IN (
        'user', 'extractor', 'system', 'import', 'client'
    )),
    reviewed_by TEXT CHECK (reviewed_by IN (
        'user', 'extractor', 'system', 'import', 'client'
    )),
    reviewed_at TEXT,
    review_note TEXT,
    accepted_memory_id TEXT REFERENCES memory_items(id) ON DELETE RESTRICT,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND accepted_memory_id IS NULL)
        OR
        (status = 'accepted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND accepted_memory_id IS NOT NULL)
        OR
        (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND accepted_memory_id IS NULL)
    )
) STRICT;

CREATE TABLE candidate_evidence (
    candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
    evidence_role TEXT NOT NULL DEFAULT 'supports'
        CHECK (evidence_role IN ('supports', 'contradicts', 'context')),
    excerpt TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (candidate_id, source_record_id, evidence_role)
) STRICT;

CREATE TABLE candidate_events (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'accepted', 'rejected')),
    actor_type TEXT NOT NULL CHECK (actor_type IN (
        'user', 'extractor', 'system', 'import', 'client'
    )),
    detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX memory_candidates_status_created_idx
    ON memory_candidates(status, created_at, id);
CREATE INDEX memory_candidates_scope_status_idx
    ON memory_candidates(scope_id, status, created_at, id);
CREATE INDEX candidate_evidence_source_idx
    ON candidate_evidence(source_record_id);
CREATE INDEX candidate_events_candidate_time_idx
    ON candidate_events(candidate_id, occurred_at, id);

INSERT INTO schema_migrations(version, name)
VALUES (2, 'ingestion_candidates_v0.4');

COMMIT;
