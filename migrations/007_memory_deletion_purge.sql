PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE memory_deletion_events (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
    previous_status TEXT NOT NULL CHECK (previous_status IN (
        'active', 'superseded', 'contradicted', 'archived', 'unknown'
    )),
    previous_archived_at TEXT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
    is_recoverable INTEGER NOT NULL DEFAULT 1 CHECK (is_recoverable IN (0, 1)),
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    restored_at TEXT,
    CHECK ((previous_status = 'archived') = (previous_archived_at IS NOT NULL)),
    CHECK (is_recoverable = 1 OR previous_status = 'unknown')
) STRICT;

CREATE UNIQUE INDEX one_open_deletion_per_memory
    ON memory_deletion_events(memory_id)
    WHERE restored_at IS NULL;

INSERT INTO memory_deletion_events (
    id, memory_id, previous_status, previous_archived_at, reason,
    actor_type, is_recoverable, deleted_at
)
SELECT
    'legacy-deletion:' || id,
    id,
    'unknown',
    NULL,
    COALESCE(NULLIF(trim(deletion_reason), ''), 'Pre-migration deletion'),
    'system',
    0,
    deleted_at
FROM memory_items
WHERE status = 'deleted';

CREATE TABLE privacy_purge_receipts (
    id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL CHECK (subject_kind = 'memory'),
    subject_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    actor_type TEXT NOT NULL CHECK (actor_type = 'user'),
    deleted_row_counts_json TEXT NOT NULL CHECK (json_valid(deleted_row_counts_json)),
    retained_source_record_count INTEGER NOT NULL CHECK (retained_source_record_count >= 0),
    external_copies_not_modified INTEGER NOT NULL DEFAULT 1
        CHECK (external_copies_not_modified = 1),
    purged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX privacy_purge_receipts_subject_idx
    ON privacy_purge_receipts(subject_kind, subject_id, purged_at DESC);

INSERT INTO schema_migrations(version, name)
VALUES (7, 'memory_deletion_purge_v0.9');

COMMIT;
