PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE candidate_resolutions (
    candidate_id TEXT PRIMARY KEY REFERENCES memory_candidates(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'create', 'revise', 'reaffirm', 'contradict', 'supersede', 'ignore'
    )),
    target_memory_id TEXT REFERENCES memory_items(id) ON DELETE RESTRICT,
    result_memory_id TEXT REFERENCES memory_items(id) ON DELETE RESTRICT,
    actor_type TEXT NOT NULL CHECK (actor_type IN (
        'user', 'extractor', 'system', 'import', 'client'
    )),
    note TEXT,
    resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (outcome = 'create' AND target_memory_id IS NULL AND result_memory_id IS NOT NULL)
        OR
        (outcome IN ('revise', 'reaffirm') AND target_memory_id IS NOT NULL
            AND result_memory_id = target_memory_id)
        OR
        (outcome IN ('contradict', 'supersede') AND target_memory_id IS NOT NULL
            AND result_memory_id IS NOT NULL AND result_memory_id <> target_memory_id)
        OR
        (outcome = 'ignore' AND target_memory_id IS NULL AND result_memory_id IS NULL)
    )
) STRICT;

CREATE INDEX candidate_resolutions_target_idx
    ON candidate_resolutions(target_memory_id, outcome, resolved_at);
CREATE INDEX candidate_resolutions_result_idx
    ON candidate_resolutions(result_memory_id, outcome, resolved_at);

INSERT INTO candidate_resolutions (
    candidate_id, outcome, target_memory_id, result_memory_id,
    actor_type, note, resolved_at
)
SELECT
    id,
    CASE status WHEN 'accepted' THEN 'create' ELSE 'ignore' END,
    NULL,
    CASE status WHEN 'accepted' THEN accepted_memory_id ELSE NULL END,
    reviewed_by,
    review_note,
    reviewed_at
FROM memory_candidates
WHERE status IN ('accepted', 'rejected')
  AND reviewed_by IS NOT NULL
  AND reviewed_at IS NOT NULL;

INSERT INTO schema_migrations(version, name)
VALUES (5, 'candidate_resolution_v0.9');

COMMIT;
