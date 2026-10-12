# MemTextual

MemTextual is a local-first persistent memory layer for AI agents. Its portable
domain model, SQLite adapter, policy-enforcing service, and local MCP transport
are kept separate so additional interfaces do not duplicate memory rules.

## Current milestone

Schema v0.1 establishes three distinct layers:

```text
source record -> extracted memory revision -> current memory state
```

This preserves what was originally said, records how it was interpreted, and
allows the current state to change without rewriting history.

The schema includes:

- source and provenance records;
- scoped, typed, revisioned memories;
- lifecycle and contradiction handling;
- entities and memory-to-memory relationships;
- user controls for pinning, protection, sensitivity, and retrieval;
- full-text search plus provider-neutral embedding metadata; and
- an audit trail for consequential changes.

Memory service v0.2 adds:

- revision history with inherited metadata for partial updates;
- archive, restore, supersede, and contradict lifecycle operations;
- explicit-user authorization for protected-memory changes;
- retrieval filtered by caller scopes and allowed sensitivities;
- pinned-result ranking, usage tracking, and retrieval audits; and
- a storage-neutral `MemoryService` API for future MCP and REST adapters.

Local MCP server v0.3 adds:

- eleven validated tools covering scopes, storage, retrieval, and lifecycle;
- the official MCP TypeScript SDK v2 stdio transport;
- an executable `memtextual-mcp` entry point;
- configurable database and migration paths; and
- in-memory protocol tests plus a real stdio handshake test.

Provenance-aware ingestion v0.4 adds:

- atomic, SHA-256-idempotent source and source-record imports;
- pending memory candidates linked to one or more evidence records;
- retained acceptance and rejection history;
- explicit-user authorization for candidate review;
- transactional acceptance that creates a memory with its provenance; and
- six MCP tools for import, proposal, and review-queue inspection.

Manual review CLI v0.5 adds:

- a trusted local accept, reject, skip, and quit workflow;
- full source-record display for candidate evidence;
- optional review notes and per-session decision summaries;
- a `memtextual-review` package binary; and
- a direct source-record lookup API and MCP tool.

Server discoverability v0.6 adds:

- a read-only `server_info` MCP tool;
- server identity and version reporting;
- a complete nineteen-tool catalog with descriptions and safety annotations;
- implemented and planned capability status; and
- no exposure of database contents, credentials, or local runtime paths.

## Repository layout

```text
docs/schema-v0.1.md        Domain model and behavioral rules
docs/service-v0.2.md       Service contract and lifecycle behavior
docs/mcp-v0.3.md           MCP tools, configuration, and host example
docs/ingestion-v0.4.md     Source ingestion and candidate review contract
docs/review-cli-v0.5.md    Trusted local candidate-review workflow
migrations/                Numbered SQLite schema migrations
examples/seed-v0.1.sql     Ten representative memories
src/database/              SQLite connection and migrations
src/domain/                Portable TypeScript domain types
src/mcp/                   MCP factory, configuration, and stdio entry point
src/repositories/          Repository contracts and SQLite adapter
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
```

The SQLite adapter applies pending numbered migrations when it opens a writable
database. The `MemoryService` exposes transactional creation, revision history,
lifecycle transitions, and policy-aware retrieval. `IngestionService` adds
source import, candidate proposal, and explicit-user review. Database-specific
behavior remains behind repository interfaces.

## Deliberately deferred

Automatic extraction, a trusted candidate-review UI, configurable manual,
bulk, automatic, and risk-based review policies, a legacy-memory migration
workflow, source versioning and purge semantics, streamable HTTP, REST API,
admin UI, embedding provider, host-specific installers, and the broader
packaging strategy remain open.
