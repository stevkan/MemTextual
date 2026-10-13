PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE source_series (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('chat', 'file', 'manual', 'app', 'api')),
    external_id TEXT NOT NULL CHECK (length(trim(external_id)) > 0),
    current_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source_kind, external_id)
) STRICT;

CREATE TABLE source_versions (
    source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE RESTRICT,
    series_id TEXT NOT NULL REFERENCES source_series(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    previous_source_id TEXT REFERENCES sources(id) ON DELETE RESTRICT,
    version_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (series_id, version_number),
    UNIQUE (series_id, previous_source_id),
    CHECK (previous_source_id IS NULL OR previous_source_id <> source_id),
    CHECK ((version_number = 1) = (previous_source_id IS NULL))
) STRICT;

CREATE INDEX source_versions_series_idx
    ON source_versions(series_id, version_number DESC);

INSERT INTO source_series (
    id, source_kind, external_id, current_source_id, created_at, updated_at
)
SELECT
    'legacy-series:' || id,
    source_kind,
    external_id,
    id,
    created_at,
    created_at
FROM sources
WHERE external_id IS NOT NULL;

INSERT INTO source_versions (
    source_id, series_id, version_number, previous_source_id, created_at
)
SELECT
    id,
    'legacy-series:' || id,
    1,
    NULL,
    created_at
FROM sources
WHERE external_id IS NOT NULL;

INSERT INTO schema_migrations(version, name)
VALUES (6, 'source_versioning_v0.9');

COMMIT;
