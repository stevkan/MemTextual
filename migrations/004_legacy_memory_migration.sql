BEGIN IMMEDIATE;

ALTER TABLE memory_candidates ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX memory_candidates_external_id_unique
    ON memory_candidates(external_id)
    WHERE external_id IS NOT NULL;

INSERT INTO schema_migrations(version, name)
VALUES (4, 'legacy_memory_migration_v0.8');

COMMIT;
