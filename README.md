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

- atomic, idempotent source ingestion with explicit immutable version history;
- scoped, typed memories with immutable revision history;
- archive, restore, supersede, and contradiction lifecycles;
- explicitly authorized recoverable deletion and confirmed memory purge;
- dependency-aware source-series deletion, restoration, and confirmed purge;
- multi-persona identity and relationship scopes with enforced ownership;
- explicit episodic and durable persona-memory classes;
- persona-aware retrieval with default-deny cross-persona isolation;
- provider-neutral ambient extraction into persona-bound review candidates;
- strict asynchronous extraction-provider and authorized host-event adapters;
- an explicit, persona-scoped user-control service for review and lifecycle actions;
- a local, persona-bound Continuity control console for review and inspection;
- explicit temporal validity, non-destructive review hints, and as-of retrieval;
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
docs/continuity-control.md Persona-scoped review and lifecycle control contract
docs/continuity-console.md Local graphical review and memory-inspection console
docs/personas.md           Continuity identity and persona-scope foundations
docs/ambient-memory.md     Persona-bound ambient candidate capture contract
docs/host-capture.md       Explicitly authorized host-event capture contract
docs/migration-safety.md   Snapshot, upgrade-copy, and verification workflow
docs/privacy.md            Recoverable deletion and memory-purge contract
docs/semantic-matching.md  Provider-neutral advisory matching contract
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
python -m sqlite3 memtextual.db ".read migrations/006_source_versioning.sql"
python -m sqlite3 memtextual.db ".read migrations/007_memory_deletion_purge.sql"
python -m sqlite3 memtextual.db ".read migrations/008_source_series_deletion_purge.sql"
python -m sqlite3 memtextual.db ".read migrations/009_persona_foundations.sql"
python -m sqlite3 memtextual.db ".read migrations/010_persona_memory_classes.sql"
python -m sqlite3 memtextual.db ".read migrations/011_ambient_capture.sql"
python -m sqlite3 memtextual.db ".read migrations/012_ambient_sensitivity.sql"
python -m sqlite3 memtextual.db ".read migrations/013_temporal_relevance.sql"
python -m sqlite3 memtextual.db ".read migrations/014_authorized_host_capture.sql"
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
npm run privacy -- preview --id MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run continuity -- --persona PERSONA_ID --database .\data\memtextual.db --migrations .\migrations
```

The SQLite adapter applies pending numbered migrations when it opens a writable
database. The `MemoryService` exposes transactional creation, revision history,
lifecycle transitions, and policy-aware retrieval. `IngestionService` adds
source import, candidate proposal, and explicit-user review. Database-specific
behavior remains behind repository interfaces.

`PersonaService` creates Continuity users and multiple personas with an
enforced user -> persona -> relationship scope hierarchy.
`ContinuityMemoryService` transactionally binds explicitly episodic or durable
memories to one relationship and retrieves them by persona identity without
accepting caller-selected scope IDs.
`ContinuityControlService` exposes persona-bound candidate queues, resolved
evidence, revision history, correction, pin/protect controls, lifecycle actions,
and privacy operations. Every mutation requires an explicit user action, and
cross-persona candidates and memory targets are rejected before delegation.
The `memtextual-continuity` CLI adds a local browser console for one selected
persona. It uses a per-launch bearer token, binds only to `127.0.0.1`, and
supports evidence-backed candidate acceptance or rejection plus memory history,
candidate reconciliation, immutable correction, pinning, protection, archive,
restore, persona-memory export, recoverable deletion, and safeguarded permanent
purge controls.
`AmbientMemoryService` imports a recorded interaction, invokes a configured
versioned extractor, and creates idempotent candidates bound to that persona's
relationship and evidence. It defaults extracted claims to inferred and pending;
only explicit review or an existing user-configured policy can accept them. A
versioned sensitivity classifier may assess proposals; absent assessment fails
closed to sensitive, and classification can never lower declared protection.
Explicit validity windows and review dates survive candidate acceptance;
default retrieval excludes out-of-window memories without deleting them and
explicit historical retrieval reports their temporal state.
`StructuredAmbientMemoryExtractor` validates asynchronous provider output
against a strict proposal schema. `HostAuthorizationService` and
`AuthorizedHostEventCaptureService` add explicit persona-scoped bearer grants,
versioned host adapters, deterministic replay protection, and immutable
successful-capture receipts without exposing these mutations through MCP.

Before a release applies new migrations to a real database, use the safeguard
workflow in `docs/migration-safety.md`. It creates an online SQLite backup, a
portable durable-data export, and a deterministic manifest that can verify an
upgraded copy without rejecting additive schema changes.

## Deliberately deferred

Concrete vendor extractor and host-event clients, vendor-specific legacy-export
adapters, graphical source-series privacy workflows, standalone-source deletion,
backup-retention enforcement, resumable imports, streamable HTTP, REST API,
admin UI, embedding provider, host-specific installers, and the broader
packaging strategy remain open.
