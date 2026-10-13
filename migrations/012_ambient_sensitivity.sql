PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN sensitivity_assessment_status TEXT NOT NULL DEFAULT 'legacy_unassessed';

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN declared_sensitivity TEXT;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN assessed_sensitivity TEXT;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN sensitivity_confidence REAL;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN sensitivity_classifier_id TEXT;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN sensitivity_classifier_version TEXT;

ALTER TABLE ambient_candidate_profiles
    ADD COLUMN sensitivity_reason_codes_json TEXT NOT NULL DEFAULT '[]';

CREATE TRIGGER ambient_candidate_sensitivity_insert
BEFORE INSERT ON ambient_candidate_profiles
WHEN NEW.sensitivity_assessment_status NOT IN ('assessed', 'unassessed')
 OR NEW.declared_sensitivity NOT IN ('normal', 'sensitive', 'restricted')
    AND NEW.declared_sensitivity IS NOT NULL
 OR NEW.assessed_sensitivity NOT IN ('normal', 'sensitive', 'restricted')
 OR NEW.sensitivity_confidence IS NULL
 OR NEW.sensitivity_confidence < 0
 OR NEW.sensitivity_confidence > 1
 OR NEW.sensitivity_classifier_id IS NULL
 OR length(trim(NEW.sensitivity_classifier_id)) = 0
 OR NEW.sensitivity_classifier_version IS NULL
 OR length(trim(NEW.sensitivity_classifier_version)) = 0
 OR NOT json_valid(NEW.sensitivity_reason_codes_json)
 OR json_type(NEW.sensitivity_reason_codes_json) <> 'array'
 OR json_array_length(NEW.sensitivity_reason_codes_json) = 0
 OR (
     NEW.sensitivity_assessment_status = 'unassessed'
     AND (
         NEW.assessed_sensitivity <> 'sensitive'
         OR NEW.sensitivity_confidence <> 0
         OR NEW.sensitivity_classifier_id <> 'memtextual.unassessed'
         OR NEW.sensitivity_classifier_version <> '1'
     )
 )
 OR NOT EXISTS (
     SELECT 1
     FROM memory_candidates candidate
     WHERE candidate.id = NEW.candidate_id
       AND CASE candidate.sensitivity
           WHEN 'normal' THEN 0
           WHEN 'sensitive' THEN 1
           WHEN 'restricted' THEN 2
           ELSE -1
       END >= CASE COALESCE(NEW.declared_sensitivity, 'normal')
           WHEN 'normal' THEN 0
           WHEN 'sensitive' THEN 1
           WHEN 'restricted' THEN 2
           ELSE 3
       END
       AND CASE candidate.sensitivity
           WHEN 'normal' THEN 0
           WHEN 'sensitive' THEN 1
           WHEN 'restricted' THEN 2
           ELSE -1
       END >= CASE NEW.assessed_sensitivity
           WHEN 'normal' THEN 0
           WHEN 'sensitive' THEN 1
           WHEN 'restricted' THEN 2
           ELSE 3
       END
 )
BEGIN
    SELECT RAISE(ABORT, 'Ambient candidate sensitivity assessment is invalid or understated');
END;

INSERT INTO schema_migrations(version, name)
VALUES (12, 'ambient_sensitivity_assessment_v0.9');

COMMIT;
