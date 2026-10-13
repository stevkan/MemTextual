PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE memory_revisions
    ADD COLUMN review_after TEXT;

ALTER TABLE memory_candidates
    ADD COLUMN valid_from TEXT;

ALTER TABLE memory_candidates
    ADD COLUMN valid_to TEXT;

ALTER TABLE memory_candidates
    ADD COLUMN review_after TEXT;

CREATE TEMP TABLE temporal_migration_validation (
    invalid_count INTEGER NOT NULL CHECK (invalid_count = 0)
);

INSERT INTO temporal_migration_validation(invalid_count)
SELECT count(*)
FROM memory_revisions
WHERE (valid_from IS NOT NULL AND julianday(valid_from) IS NULL)
   OR (valid_to IS NOT NULL AND julianday(valid_to) IS NULL)
   OR (
       valid_from IS NOT NULL
       AND valid_to IS NOT NULL
       AND julianday(valid_to) < julianday(valid_from)
   );

DROP TABLE temporal_migration_validation;

CREATE TRIGGER memory_revision_temporal_insert
BEFORE INSERT ON memory_revisions
WHEN (NEW.valid_from IS NOT NULL AND julianday(NEW.valid_from) IS NULL)
 OR (NEW.valid_to IS NOT NULL AND julianday(NEW.valid_to) IS NULL)
 OR (NEW.review_after IS NOT NULL AND julianday(NEW.review_after) IS NULL)
 OR (
     NEW.valid_from IS NOT NULL
     AND NEW.valid_to IS NOT NULL
     AND julianday(NEW.valid_to) < julianday(NEW.valid_from)
 )
BEGIN
    SELECT RAISE(ABORT, 'Memory temporal bounds are invalid');
END;

CREATE TRIGGER memory_candidate_temporal_insert
BEFORE INSERT ON memory_candidates
WHEN (NEW.valid_from IS NOT NULL AND julianday(NEW.valid_from) IS NULL)
 OR (NEW.valid_to IS NOT NULL AND julianday(NEW.valid_to) IS NULL)
 OR (NEW.review_after IS NOT NULL AND julianday(NEW.review_after) IS NULL)
 OR (
     NEW.valid_from IS NOT NULL
     AND NEW.valid_to IS NOT NULL
     AND julianday(NEW.valid_to) < julianday(NEW.valid_from)
 )
BEGIN
    SELECT RAISE(ABORT, 'Candidate temporal bounds are invalid');
END;

CREATE TRIGGER memory_candidate_temporal_update
BEFORE UPDATE OF valid_from, valid_to, review_after ON memory_candidates
WHEN (NEW.valid_from IS NOT NULL AND julianday(NEW.valid_from) IS NULL)
 OR (NEW.valid_to IS NOT NULL AND julianday(NEW.valid_to) IS NULL)
 OR (NEW.review_after IS NOT NULL AND julianday(NEW.review_after) IS NULL)
 OR (
     NEW.valid_from IS NOT NULL
     AND NEW.valid_to IS NOT NULL
     AND julianday(NEW.valid_to) < julianday(NEW.valid_from)
 )
BEGIN
    SELECT RAISE(ABORT, 'Candidate temporal bounds are invalid');
END;

INSERT INTO schema_migrations(version, name)
VALUES (13, 'temporal_relevance_v0.9');

COMMIT;
