BEGIN IMMEDIATE;

ALTER TABLE memory_candidates ADD COLUMN proposer_id TEXT;

CREATE TABLE review_policies (
    id TEXT PRIMARY KEY,
    scope_id TEXT REFERENCES scopes(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    version INTEGER NOT NULL CHECK (version >= 1),
    mode TEXT NOT NULL CHECK (mode IN (
        'manual', 'automatic_explicit', 'automatic_threshold', 'risk_based'
    )),
    conditions_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(conditions_json)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_by TEXT NOT NULL CHECK (created_by = 'user'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deactivated_at TEXT
) STRICT;

CREATE UNIQUE INDEX review_policies_target_version_unique
    ON review_policies(COALESCE(scope_id, ''), version);
CREATE UNIQUE INDEX review_policies_one_active_global
    ON review_policies(is_active)
    WHERE scope_id IS NULL AND is_active = 1;
CREATE UNIQUE INDEX review_policies_one_active_scope
    ON review_policies(scope_id)
    WHERE scope_id IS NOT NULL AND is_active = 1;
CREATE INDEX review_policies_scope_history_idx
    ON review_policies(scope_id, version DESC);

CREATE TABLE review_policy_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES review_policies(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'activated', 'deactivated')),
    actor_type TEXT NOT NULL CHECK (actor_type = 'user'),
    detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX review_policy_events_policy_time_idx
    ON review_policy_events(policy_id, occurred_at, id);

INSERT INTO schema_migrations(version, name)
VALUES (3, 'candidate_review_automation_v0.7');

COMMIT;
