# MemTextual

MemTextual is a local-first persistent memory layer for AI agents. Its portable
domain model, SQLite adapter, policy-enforcing service, and local MCP transport
are kept separate so additional interfaces do not duplicate memory rules.

## Design

MemTextual separates source evidence, proposed interpretations, immutable
memory revisions, and current memory state:

```text
source record -> candidate -> memory revision -> current memory state
```

Imported material remains source evidence until a candidate is accepted. Manual
review is the default. Optional persisted policies can automatically accept
narrowly eligible candidates while conservative guardrails leave uncertain or
risky candidates pending.

The system provides:

- atomic, idempotent source ingestion with retained provenance;
- scoped, typed memories with immutable revision history;
- archive, restore, supersede, and contradiction lifecycles;
- sensitivity, retrieval, pinning, and protection controls;
- policy-aware FTS5 retrieval and retrieval audits;
- a trusted terminal workflow for candidate review;
- deterministic duplicate suggestions and explicit candidate reconciliation;
- an idempotent, review-gated legacy-memory migration CLI;
- versioned global and scope-specific review-automation policies;
- consistent database snapshots with durable-data preservation verification; and
- a local stdio MCP server with capability discovery.

## Repository layout

```text
CHANGELOG.md               Version history
docs/schema.md             Domain model and behavioral rules
docs/service.md            Service contract and lifecycle behavior
docs/mcp.md                MCP tools, configuration, and host example
docs/ingestion.md          Source ingestion and candidate review contract
docs/legacy-migration.md   Legacy export format and migration workflow
docs/continuity-design.md  Continuity product plan and non-destructive contract
docs/migration-safety.md   Snapshot, upgrade-copy, and verification workflow
docs/review-cli.md         Trusted local candidate-review workflow
docs/review-automation.md  Configurable review-policy contract and CLI
migrations/                Numbered SQLite schema migrations
examples/seed-v0.1.sql     Ten representative memories
src/database/              SQLite connection and migrations
src/domain/                Portable TypeScript domain types
src/mcp/                   MCP factory, configuration, and stdio entry point
src/repositories/          Repository contracts and SQLite adapter
src/safeguards/            Database snapshot and preservation verification
src/services/              Policy-enforcing application services
test/                      Schema, service, and MCP integration tests
```

The implementation uses TypeScript, Node.js, and `better-sqlite3`.

## Validate locally

The migration and seed file can be loaded by any recent SQLite build with
JSON1 and FTS5 enabled. For example:

```powershell
python -m sqlite3 memtextual.db ".read migrations/001_initial.sql"
python -m sqlite3 memtextual.db ".read migrations/002_ingestion_candidates.sql"
python -m sqlite3 memtextual.db ".read migrations/003_review_automation.sql"
python -m sqlite3 memtextual.db ".read migrations/004_legacy_memory_migration.sql"
python -m sqlite3 memtextual.db ".read migrations/005_candidate_resolution.sql"
python -m sqlite3 memtextual.db ".read examples/seed-v0.1.sql"
```

Database files are ignored by Git.

## Develop

The repository's `.node-version` pins Node.js 24.21.0. When NVS is initialized
by your PowerShell profile, entering the directory selects that runtime.

```powershell
npm install
npm test
npm run typecheck
npm run build
npm run mcp -- --database .\data\memtextual.db --migrations .\migrations
npm run review -- --database .\data\memtextual.db --migrations .\migrations
npm run policy -- list --database .\data\memtextual.db --migrations .\migrations
npm run migrate -- --file .\legacy-memories.json --scope PROJECT_SCOPE_ID --database .\data\memtextual.db --migrations .\migrations
npm run safeguard -- snapshot -- --database .\data\memtextual.db --output .\backups
```

The SQLite adapter applies pending numbered migrations when it opens a writable
database. The `MemoryService` exposes transactional creation, revision history,
lifecycle transitions, and policy-aware retrieval. `IngestionService` adds
source import, candidate proposal, and explicit-user review. Database-specific
behavior remains behind repository interfaces.

Before a release applies new migrations to a real database, use the safeguard
workflow in `docs/migration-safety.md`. It creates an online SQLite backup, a
portable durable-data export, and a deterministic manifest that can verify an
upgraded copy without rejecting additive schema changes.

## Deliberately deferred

Automatic extraction, vendor-specific legacy-export adapters, a trusted
graphical candidate-review UI, semantic candidate deduplication and conflict matching,
source versioning and purge semantics, streamable HTTP, REST API, admin UI,
embedding provider, host-specific installers, and the broader packaging
strategy remain open.
