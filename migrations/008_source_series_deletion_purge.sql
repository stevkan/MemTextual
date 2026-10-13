PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE source_series_deletion_events (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL REFERENCES source_series(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
    is_recoverable INTEGER NOT NULL DEFAULT 1 CHECK (is_recoverable IN (0, 1)),
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    restored_at TEXT
) STRICT;

CREATE UNIQUE INDEX one_open_source_series_deletion
    ON source_series_deletion_events(series_id)
    WHERE restored_at IS NULL;

CREATE TABLE source_series_deletion_sources (
    deletion_event_id TEXT NOT NULL
        REFERENCES source_series_deletion_events(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    previous_deleted_at TEXT,
    PRIMARY KEY (deletion_event_id, source_id)
) STRICT;

CREATE TABLE source_series_deletion_records (
    deletion_event_id TEXT NOT NULL
        REFERENCES source_series_deletion_events(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
    previous_deleted_at TEXT,
    PRIMARY KEY (deletion_event_id, source_record_id)
) STRICT;

INSERT INTO source_series_deletion_events (
    id, series_id, reason, actor_type, is_recoverable, deleted_at
)
SELECT
    'legacy-source-deletion:' || ss.id,
    ss.id,
    'Pre-migration source deletion',
    'system',
    0,
    s.deleted_at
FROM source_series ss
JOIN sources s ON s.id = ss.current_source_id
WHERE s.deleted_at IS NOT NULL;

CREATE TABLE source_purge_receipts (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('chat', 'file', 'manual', 'app', 'api')),
    external_id TEXT NOT NULL CHECK (length(trim(external_id)) > 0),
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    actor_type TEXT NOT NULL CHECK (actor_type = 'user'),
    deleted_row_counts_json TEXT NOT NULL CHECK (json_valid(deleted_row_counts_json)),
    external_copies_not_modified INTEGER NOT NULL DEFAULT 1
        CHECK (external_copies_not_modified = 1),
    purged_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX source_purge_receipts_identity_idx
    ON source_purge_receipts(source_kind, external_id, purged_at DESC);

INSERT INTO schema_migrations(version, name)
VALUES (8, 'source_series_deletion_purge_v0.9');

COMMIT;
