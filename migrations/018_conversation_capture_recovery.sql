PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_conversation_turn_captures (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL
        REFERENCES continuity_conversations(id) ON DELETE RESTRICT,
    external_turn_id TEXT NOT NULL CHECK (
        length(trim(external_turn_id)) BETWEEN 1 AND 500
    ),
    external_event_id TEXT NOT NULL UNIQUE CHECK (
        length(trim(external_event_id)) BETWEEN 1 AND 500
    ),
    user_text TEXT NOT NULL CHECK (length(user_text) > 0),
    assistant_text TEXT NOT NULL,
    completed_at TEXT NOT NULL CHECK (julianday(completed_at) IS NOT NULL),
    context_format_version INTEGER NOT NULL CHECK (context_format_version >= 1),
    memory_revision_ids_json TEXT NOT NULL CHECK (
        json_valid(memory_revision_ids_json)
        AND json_type(memory_revision_ids_json) = 'array'
    ),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'failed', 'captured')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TEXT CHECK (
        last_attempt_at IS NULL OR julianday(last_attempt_at) IS NOT NULL
    ),
    failure_code TEXT CHECK (
        failure_code IS NULL
        OR (
            length(failure_code) BETWEEN 1 AND 100
            AND failure_code NOT GLOB '*[^a-z0-9_]*'
        )
    ),
    receipt_id TEXT REFERENCES continuity_host_events(id) ON DELETE RESTRICT,
    captured_at TEXT CHECK (captured_at IS NULL OR julianday(captured_at) IS NOT NULL),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (conversation_id, external_turn_id),
    CHECK (
        (status = 'pending'
         AND attempt_count = 0
         AND last_attempt_at IS NULL
         AND failure_code IS NULL
         AND receipt_id IS NULL
         AND captured_at IS NULL)
        OR
        (status = 'failed'
         AND attempt_count >= 1
         AND last_attempt_at IS NOT NULL
         AND failure_code IS NOT NULL
         AND receipt_id IS NULL
         AND captured_at IS NULL)
        OR
        (status = 'captured'
         AND attempt_count >= 1
         AND last_attempt_at IS NOT NULL
         AND failure_code IS NULL
         AND receipt_id IS NOT NULL
         AND captured_at IS NOT NULL)
    )
) STRICT;

CREATE INDEX continuity_turn_captures_recovery_idx
    ON continuity_conversation_turn_captures(status, conversation_id, completed_at, id);

CREATE TRIGGER continuity_turn_capture_revisions_insert
BEFORE INSERT ON continuity_conversation_turn_captures
WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.memory_revision_ids_json) revision
    WHERE revision.type <> 'text'
       OR length(trim(revision.value)) = 0
)
OR (
    SELECT count(*) FROM json_each(NEW.memory_revision_ids_json)
) <> (
    SELECT count(DISTINCT value)
    FROM json_each(NEW.memory_revision_ids_json)
)
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture memory revisions are invalid');
END;

CREATE TRIGGER continuity_turn_capture_payload_immutable
BEFORE UPDATE ON continuity_conversation_turn_captures
WHEN NEW.conversation_id IS NOT OLD.conversation_id
 OR NEW.external_turn_id IS NOT OLD.external_turn_id
 OR NEW.external_event_id IS NOT OLD.external_event_id
 OR NEW.user_text IS NOT OLD.user_text
 OR NEW.assistant_text IS NOT OLD.assistant_text
 OR NEW.completed_at IS NOT OLD.completed_at
 OR NEW.context_format_version IS NOT OLD.context_format_version
 OR NEW.memory_revision_ids_json IS NOT OLD.memory_revision_ids_json
 OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture payload cannot be changed');
END;

CREATE TRIGGER continuity_turn_capture_transition
BEFORE UPDATE ON continuity_conversation_turn_captures
WHEN (
    NEW.status IS NOT OLD.status
 OR NEW.attempt_count IS NOT OLD.attempt_count
 OR NEW.last_attempt_at IS NOT OLD.last_attempt_at
 OR NEW.failure_code IS NOT OLD.failure_code
 OR NEW.receipt_id IS NOT OLD.receipt_id
 OR NEW.captured_at IS NOT OLD.captured_at
 OR NEW.updated_at IS NOT OLD.updated_at
)
AND (
    OLD.status = 'captured'
 OR NEW.status NOT IN ('failed', 'captured')
 OR NEW.attempt_count <> OLD.attempt_count + 1
 OR NEW.last_attempt_at IS NULL
 OR NEW.updated_at IS NOT NEW.last_attempt_at
)
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture state transition is invalid');
END;

CREATE TRIGGER continuity_turn_capture_receipt_update
BEFORE UPDATE ON continuity_conversation_turn_captures
WHEN NEW.status = 'captured'
 AND NOT EXISTS (
    SELECT 1
    FROM continuity_conversations conversation
    JOIN continuity_host_events receipt
      ON receipt.id = NEW.receipt_id
    WHERE conversation.id = NEW.conversation_id
      AND receipt.authorization_id = conversation.authorization_id
      AND receipt.external_event_id = NEW.external_event_id
      AND receipt.event_kind = 'conversation.turn.completed'
      AND receipt.host_id = conversation.host_id
      AND receipt.persona_id = conversation.persona_id
      AND receipt.relationship_id = conversation.relationship_id
 )
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture receipt does not match its turn');
END;

CREATE TRIGGER continuity_turn_capture_no_delete
BEFORE DELETE ON continuity_conversation_turn_captures
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture journal entries cannot be deleted');
END;

INSERT INTO schema_migrations(version, name)
VALUES (18, 'conversation_capture_recovery_v0.9');

COMMIT;
