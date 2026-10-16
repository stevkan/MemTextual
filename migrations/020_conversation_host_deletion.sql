PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_conversation_host_deletions (
    conversation_id TEXT PRIMARY KEY
        REFERENCES continuity_conversations(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'failed', 'deleted')),
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    last_attempt_at TEXT NOT NULL CHECK (julianday(last_attempt_at) IS NOT NULL),
    failure_code TEXT CHECK (
        failure_code IS NULL
        OR (
            length(failure_code) BETWEEN 1 AND 100
            AND failure_code NOT GLOB '*[^a-z0-9_]*'
        )
    ),
    deleted_at TEXT CHECK (deleted_at IS NULL OR julianday(deleted_at) IS NOT NULL),
    updated_at TEXT NOT NULL CHECK (julianday(updated_at) IS NOT NULL),
    CHECK (
        (status = 'pending' AND failure_code IS NULL AND deleted_at IS NULL)
        OR (status = 'failed' AND failure_code IS NOT NULL AND deleted_at IS NULL)
        OR (status = 'deleted' AND failure_code IS NULL AND deleted_at IS NOT NULL)
    )
) STRICT;

CREATE TRIGGER continuity_conversation_host_deletion_transition
BEFORE UPDATE ON continuity_conversation_host_deletions
WHEN OLD.status = 'deleted'
 OR NEW.conversation_id IS NOT OLD.conversation_id
 OR NEW.attempt_count < OLD.attempt_count
 OR NEW.attempt_count > OLD.attempt_count + 1
 OR (NEW.attempt_count = OLD.attempt_count + 1 AND NEW.status <> 'pending')
 OR (NEW.attempt_count = OLD.attempt_count AND OLD.status <> 'pending')
 OR NEW.updated_at < OLD.updated_at
BEGIN
    SELECT RAISE(ABORT, 'Conversation host deletion transition is invalid');
END;

CREATE TRIGGER continuity_conversation_host_deletion_no_delete
BEFORE DELETE ON continuity_conversation_host_deletions
BEGIN
    SELECT RAISE(ABORT, 'Conversation host deletion records cannot be deleted');
END;

INSERT INTO schema_migrations(version, name)
VALUES (20, 'conversation_host_deletion_v0.9');

COMMIT;
