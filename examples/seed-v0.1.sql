PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT INTO scopes(id, scope_kind, name, external_key) VALUES
    ('scope_global', 'global', 'Global', 'global'),
    ('scope_memtextual', 'project', 'MemTextual', 'project:memtextual'),
    ('scope_schema_chat', 'conversation', 'Schema design conversation', 'conversation:schema-design');

INSERT INTO sources(id, source_kind, title, external_id, captured_at) VALUES
    ('source_schema_chat', 'chat', 'Design MemTextual Schema', 'chat:schema-design', '2026-10-07T23:00:00.000Z'),
    ('source_manual', 'manual', 'User-maintained facts', 'manual:primary', '2026-10-07T23:00:00.000Z');

INSERT INTO source_records(id, source_id, ordinal, author_role, content, occurred_at) VALUES
    ('record_01', 'source_schema_chat', 1, 'user', 'The installable product is called MemTextual.', '2026-10-07T23:01:00.000Z'),
    ('record_02', 'source_schema_chat', 2, 'assistant', 'MemTextual should be local-first and open-source-friendly.', '2026-10-07T23:02:00.000Z'),
    ('record_03', 'source_schema_chat', 3, 'assistant', 'SQLite is the initial local database.', '2026-10-07T23:03:00.000Z'),
    ('record_04', 'source_schema_chat', 4, 'assistant', 'The product should expose a local MCP server.', '2026-10-07T23:04:00.000Z'),
    ('record_05', 'source_schema_chat', 5, 'assistant', 'The product may expose a REST API and admin UI.', '2026-10-07T23:05:00.000Z'),
    ('record_06', 'source_schema_chat', 6, 'assistant', 'Source records must remain separate from extracted memories.', '2026-10-07T23:06:00.000Z'),
    ('record_07', 'source_schema_chat', 7, 'assistant', 'Memories need lifecycle states and revision history.', '2026-10-07T23:07:00.000Z'),
    ('record_08', 'source_schema_chat', 8, 'assistant', 'Retrieval must support semantic search without provider lock-in.', '2026-10-07T23:08:00.000Z'),
    ('record_09', 'source_schema_chat', 9, 'user', 'GitHub will hold the version-controlled repository.', '2026-10-07T23:09:00.000Z'),
    ('record_10', 'source_manual', 1, 'user', 'The user has final control over stored and retrieved memories.', '2026-10-07T23:10:00.000Z');

INSERT INTO entities(id, entity_type, canonical_name, description) VALUES
    ('entity_memtextual', 'product', 'MemTextual', 'Local, persistent memory for AI agents'),
    ('entity_sqlite', 'product', 'SQLite', 'Initial embedded database'),
    ('entity_github', 'organization', 'GitHub', 'Source repository host'),
    ('entity_mcp', 'concept', 'Model Context Protocol', 'Agent integration interface');

INSERT INTO entity_aliases(entity_id, alias) VALUES
    ('entity_mcp', 'MCP');

INSERT INTO memory_items(id, memory_type, is_pinned, is_protected) VALUES
    ('memory_01', 'decision', 1, 1),
    ('memory_02', 'decision', 1, 0),
    ('memory_03', 'decision', 0, 0),
    ('memory_04', 'goal', 0, 0),
    ('memory_05', 'goal', 0, 0),
    ('memory_06', 'instruction', 0, 1),
    ('memory_07', 'instruction', 0, 0),
    ('memory_08', 'goal', 0, 0),
    ('memory_09', 'decision', 0, 0),
    ('memory_10', 'instruction', 1, 1);

INSERT INTO memory_revisions(
    id, memory_id, revision_number, assertion, normalized_assertion,
    explicitness, confidence, change_kind, observed_at, created_by
) VALUES
    ('revision_01', 'memory_01', 1, 'The installable product is named MemTextual.', 'product name: MemTextual', 'explicit', 1.0, 'created', '2026-10-07T23:01:00.000Z', 'user'),
    ('revision_02', 'memory_02', 1, 'MemTextual is a local-first product.', 'architecture: local-first', 'explicit', 0.98, 'created', '2026-10-07T23:02:00.000Z', 'extractor'),
    ('revision_03', 'memory_03', 1, 'SQLite is the initial local database.', 'database: SQLite', 'explicit', 1.0, 'created', '2026-10-07T23:03:00.000Z', 'extractor'),
    ('revision_04', 'memory_04', 1, 'Expose a local MCP server for compatible AI clients.', 'interface: local MCP server', 'explicit', 0.96, 'created', '2026-10-07T23:04:00.000Z', 'extractor'),
    ('revision_05', 'memory_05', 1, 'Plan for a REST API and an admin UI.', 'interfaces: REST API and admin UI', 'explicit', 0.85, 'created', '2026-10-07T23:05:00.000Z', 'extractor'),
    ('revision_06', 'memory_06', 1, 'Keep source records separate from extracted memories.', 'provenance rule: separate source and memory', 'explicit', 1.0, 'created', '2026-10-07T23:06:00.000Z', 'extractor'),
    ('revision_07', 'memory_07', 1, 'Preserve memory revision and lifecycle history.', 'history rule: revisioned lifecycle', 'explicit', 1.0, 'created', '2026-10-07T23:07:00.000Z', 'extractor'),
    ('revision_08', 'memory_08', 1, 'Support semantic retrieval without locking into one embedding provider.', 'search: provider-neutral semantic retrieval', 'explicit', 0.95, 'created', '2026-10-07T23:08:00.000Z', 'extractor'),
    ('revision_09', 'memory_09', 1, 'Use GitHub for version control and distribution.', 'repository and distribution: GitHub', 'explicit', 0.98, 'created', '2026-10-07T23:09:00.000Z', 'extractor'),
    ('revision_10', 'memory_10', 1, 'The user controls what MemTextual stores and retrieves.', 'user control over storage and retrieval', 'explicit', 1.0, 'created', '2026-10-07T23:10:00.000Z', 'user');

UPDATE memory_items
SET current_revision_id = 'revision_' || substr(id, -2),
    updated_at = '2026-10-07T23:11:00.000Z';

INSERT INTO memory_evidence(memory_revision_id, source_record_id, excerpt)
SELECT 'revision_' || substr(id, -2), id, content
FROM source_records;

INSERT INTO memory_scopes(memory_id, scope_id, is_primary)
SELECT id, 'scope_memtextual', 1 FROM memory_items;

INSERT INTO memory_scopes(memory_id, scope_id, is_primary) VALUES
    ('memory_01', 'scope_global', 0),
    ('memory_06', 'scope_schema_chat', 0),
    ('memory_07', 'scope_schema_chat', 0);

INSERT INTO memory_entities(memory_id, entity_id, entity_role) VALUES
    ('memory_01', 'entity_memtextual', 'subject'),
    ('memory_02', 'entity_memtextual', 'subject'),
    ('memory_03', 'entity_memtextual', 'subject'),
    ('memory_03', 'entity_sqlite', 'object'),
    ('memory_04', 'entity_memtextual', 'subject'),
    ('memory_04', 'entity_mcp', 'object'),
    ('memory_09', 'entity_memtextual', 'subject'),
    ('memory_09', 'entity_github', 'object'),
    ('memory_10', 'entity_memtextual', 'context');

INSERT INTO memory_relations(from_memory_id, to_memory_id, relation_type, created_by) VALUES
    ('memory_03', 'memory_02', 'depends_on', 'extractor'),
    ('memory_04', 'memory_02', 'depends_on', 'extractor'),
    ('memory_05', 'memory_02', 'depends_on', 'extractor'),
    ('memory_08', 'memory_03', 'depends_on', 'extractor'),
    ('memory_10', 'memory_06', 'relates_to', 'extractor');

INSERT INTO memory_search_documents(memory_id, revision_id, search_text)
SELECT m.id, r.id, r.assertion || ' ' || coalesce(r.normalized_assertion, '')
FROM memory_items m
JOIN memory_revisions r ON r.id = m.current_revision_id;

INSERT INTO audit_events(id, memory_id, event_type, actor_type, detail_json, occurred_at)
SELECT 'audit_' || substr(id, -2), id, 'created', 'import', '{"seed":"v0.1"}', '2026-10-07T23:11:00.000Z'
FROM memory_items;

COMMIT;
