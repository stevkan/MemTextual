PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE ambient_candidate_profiles (
    candidate_id TEXT PRIMARY KEY REFERENCES memory_candidates(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES continuity_users(id) ON DELETE RESTRICT,
    persona_id TEXT NOT NULL,
    relationship_id TEXT NOT NULL REFERENCES continuity_relationships(id) ON DELETE RESTRICT,
    memory_class TEXT NOT NULL CHECK (memory_class IN ('episodic', 'durable')),
    extractor_id TEXT NOT NULL CHECK (length(trim(extractor_id)) > 0),
    extractor_version TEXT NOT NULL CHECK (length(trim(extractor_version)) > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (persona_id, user_id)
        REFERENCES continuity_personas(id, user_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX ambient_candidate_profiles_persona_idx
    ON ambient_candidate_profiles(persona_id, memory_class, candidate_id);

CREATE INDEX ambient_candidate_profiles_source_idx
    ON ambient_candidate_profiles(source_id, candidate_id);

CREATE TRIGGER ambient_candidate_context_insert
BEFORE INSERT ON ambient_candidate_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM continuity_relationships relationship
    WHERE relationship.id = NEW.relationship_id
      AND relationship.user_id = NEW.user_id
      AND relationship.persona_id = NEW.persona_id
)
BEGIN
    SELECT RAISE(ABORT, 'Ambient candidate relationship does not match its owner');
END;

CREATE TRIGGER ambient_candidate_scope_insert
BEFORE INSERT ON ambient_candidate_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM memory_candidates candidate
    JOIN continuity_relationships relationship
      ON relationship.id = NEW.relationship_id
    WHERE candidate.id = NEW.candidate_id
      AND candidate.status = 'pending'
      AND candidate.scope_id = relationship.scope_id
      AND candidate.proposed_by = 'extractor'
      AND candidate.proposer_id = NEW.extractor_id
)
BEGIN
    SELECT RAISE(ABORT, 'Ambient candidate must be pending and extractor-bound to its relationship scope');
END;

CREATE TRIGGER ambient_candidate_source_insert
BEFORE INSERT ON ambient_candidate_profiles
WHEN NOT EXISTS (
    SELECT 1
    FROM sources source
    WHERE source.id = NEW.source_id
      AND source.deleted_at IS NULL
)
OR NOT EXISTS (
    SELECT 1
    FROM candidate_evidence evidence
    JOIN source_records record ON record.id = evidence.source_record_id
    WHERE evidence.candidate_id = NEW.candidate_id
      AND record.source_id = NEW.source_id
      AND record.deleted_at IS NULL
)
OR EXISTS (
    SELECT 1
    FROM candidate_evidence evidence
    JOIN source_records record ON record.id = evidence.source_record_id
    WHERE evidence.candidate_id = NEW.candidate_id
      AND (record.source_id <> NEW.source_id OR record.deleted_at IS NOT NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'Ambient candidate evidence must come from its active captured source');
END;

CREATE TRIGGER ambient_candidate_identity_immutable
BEFORE UPDATE ON ambient_candidate_profiles
BEGIN
    SELECT RAISE(ABORT, 'Ambient candidate provenance cannot be changed');
END;

CREATE TRIGGER ambient_candidate_acceptance_profile
AFTER UPDATE OF status, accepted_memory_id ON memory_candidates
WHEN NEW.status = 'accepted'
 AND NEW.accepted_memory_id IS NOT NULL
 AND EXISTS (
     SELECT 1 FROM ambient_candidate_profiles
     WHERE candidate_id = NEW.id
 )
BEGIN
    INSERT INTO continuity_memory_profiles (
        memory_id, user_id, persona_id, relationship_id, memory_class
    )
    SELECT
        NEW.accepted_memory_id,
        profile.user_id,
        profile.persona_id,
        profile.relationship_id,
        profile.memory_class
    FROM ambient_candidate_profiles profile
    WHERE profile.candidate_id = NEW.id
      AND NOT EXISTS (
          SELECT 1 FROM continuity_memory_profiles existing
          WHERE existing.memory_id = NEW.accepted_memory_id
      );
END;

INSERT INTO schema_migrations(version, name)
VALUES (11, 'ambient_candidate_capture_v0.9');

COMMIT;
