PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE continuity_conversation_journal_purge_receipts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE
        REFERENCES continuity_conversations(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL REFERENCES continuity_personas(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
    deleted_row_counts_json TEXT NOT NULL CHECK (
        json_valid(deleted_row_counts_json)
        AND json_type(deleted_row_counts_json) = 'object'
    ),
    external_copies_not_modified INTEGER NOT NULL DEFAULT 1
        CHECK (external_copies_not_modified = 1),
    purged_at TEXT NOT NULL CHECK (julianday(purged_at) IS NOT NULL)
) STRICT;

CREATE TRIGGER continuity_conversation_journal_purge_receipt_immutable
BEFORE UPDATE ON continuity_conversation_journal_purge_receipts
BEGIN
    SELECT RAISE(ABORT, 'Conversation journal purge receipts cannot be changed');
END;

CREATE TRIGGER continuity_conversation_journal_purge_receipt_no_delete
BEFORE DELETE ON continuity_conversation_journal_purge_receipts
BEGIN
    SELECT RAISE(ABORT, 'Conversation journal purge receipts cannot be deleted');
END;

DROP TRIGGER continuity_turn_capture_no_delete;

CREATE TRIGGER continuity_turn_capture_delete_requires_purge_receipt
BEFORE DELETE ON continuity_conversation_turn_captures
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_conversation_journal_purge_receipts receipt
    WHERE receipt.conversation_id = OLD.conversation_id
)
BEGIN
    SELECT RAISE(ABORT, 'Conversation capture journal entries require a purge receipt before deletion');
END;

CREATE TRIGGER continuity_turn_capture_no_insert_after_purge
BEFORE INSERT ON continuity_conversation_turn_captures
WHEN EXISTS (
    SELECT 1
    FROM continuity_conversation_journal_purge_receipts receipt
    WHERE receipt.conversation_id = NEW.conversation_id
)
BEGIN
    SELECT RAISE(ABORT, 'A purged conversation journal cannot accept new captures');
END;

INSERT INTO schema_migrations(version, name)
VALUES (21, 'conversation_journal_purge_v0.9');

COMMIT;
