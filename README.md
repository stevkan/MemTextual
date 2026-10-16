# MemTextual

MemTextual is a local-first persistent memory layer for AI agents. Its portable
domain model, SQLite adapter, policy-enforcing service, and local MCP transport
are kept separate so additional interfaces do not duplicate memory rules.

## Editions

- **MemTextual Developer** is the developer edition for explicit tools,
  integrations, and project-oriented workflows.
- **MemTextual Continuity** is the personal edition for user-controlled memory
  across one or more personas.

Both editions share MemTextual Core. Windows is the initial supported desktop
target for Continuity. Core compatibility checks are configured for Windows,
macOS, and Linux while platform-specific installers and unattended integrations
are delivered separately. See `docs/platform-support.md` for the support and
release policy.

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
- a provider-neutral conversation-host contract with an initial local Codex App
  Server stdio adapter;
- immutable persona-to-host conversation bindings and authorized completed-turn
  orchestration into the ambient-memory pipeline;
- a durable completed-turn capture journal with persona-bound, idempotent retry;
- fail-closed host-history reconciliation for completed turns missing from that
  journal;
- a client lifecycle gate that reconciles persisted conversations, blocks on
  unresolved capture recovery, and prevents overlapping turns;
- an explicit, persona-scoped user-control service for review and lifecycle actions;
- a local, persona-bound Continuity control console for explicit memory creation,
  review, and inspection;
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
docs/platform-support.md   Edition names, portability boundary, and release gates
docs/proprietary-distribution.md Proprietary-first release and IP safeguards
docs/windows-host-integration.md Windows identity, ACL, and task safeguards
docs/windows-continuity-deployment.md Windows deployment layout and installer CLI
docs/windows-continuity-bundle.md Signed Windows bundle verification and staging
docs/continuity-control.md Persona-scoped review and lifecycle control contract
docs/continuity-console.md Local graphical review and memory-inspection console
docs/continuity-setup.md   Safeguarded first-run user and persona onboarding
docs/context-composition.md Bounded persona-memory context payload contract
docs/automatic-backups.md  Opt-in everyday backup orchestration and health
docs/replication-destinations.md Encrypted destination-adapter contract
docs/personas.md           Continuity identity and persona-scope foundations
docs/ambient-memory.md     Persona-bound ambient candidate capture contract
docs/host-capture.md       Explicitly authorized host-event capture contract
docs/conversation-host.md  Client conversation-host contract and Codex adapter
docs/continuity-conversations.md Persona-bound turn orchestration and capture
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
python -m sqlite3 memtextual.db ".read migrations/015_persona_ranking.sql"
python -m sqlite3 memtextual.db ".read migrations/016_emotional_relevance.sql"
python -m sqlite3 memtextual.db ".read migrations/017_continuity_conversations.sql"
python -m sqlite3 memtextual.db ".read migrations/018_conversation_capture_recovery.sql"
python -m sqlite3 memtextual.db ".read examples/seed-v0.1.sql"
```

Database files are ignored by Git.

## Develop

MemTextual requires Node.js 24.21.0. Confirm that exact runtime is active before
installing dependencies, building, or running the project.

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
npm run safeguard -- run-if-due --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
npm run safeguard -- status --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
npm run safeguard -- retention-preview --database .\data\memtextual.db --output D:\MemTextualBackups --daily 7 --weekly 4 --monthly 12 --time-zone America/Los_Angeles --week-starts-on 0
npm run safeguard -- restore-drill --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
npm run safeguard -- restore-drill-status --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
npm run safeguard -- restore-preview --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot SNAPSHOT_DIRECTORY
npm run safeguard -- restore-apply --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot SNAPSHOT_DIRECTORY --confirm "EXACT TOKEN FROM PREVIEW"
npm run safeguard -- offsite-export --database .\data\memtextual.db --source D:\MemTextualBackups --destination E:\MemTextualOffsite --snapshot SNAPSHOT_DIRECTORY --key-env MEMTEXTUAL_OFFSITE_KEY --key-id KEY_ID
npm run safeguard -- offsite-run-if-due --database .\data\memtextual.db --source D:\MemTextualBackups --adapter local-directory --destination E:\MemTextualOffsite --interval-hours 24 --key-env MEMTEXTUAL_OFFSITE_KEY --key-id KEY_ID
npm run safeguard -- offsite-status --database .\data\memtextual.db --source D:\MemTextualBackups --adapter local-directory --destination E:\MemTextualOffsite --interval-hours 24
npm run safeguard -- offsite-verify --package E:\MemTextualOffsite\PACKAGE_DIRECTORY --key-env MEMTEXTUAL_OFFSITE_KEY
npm run safeguard -- offsite-import --database .\data\memtextual.db --package E:\MemTextualOffsite\PACKAGE_DIRECTORY --destination D:\MemTextualBackups --key-env MEMTEXTUAL_OFFSITE_KEY
npm run privacy -- preview --id MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run continuity-setup -- status -- --database .\data\memtextual.db --migrations .\migrations
npm run continuity-setup -- setup -- --user-name "Steve" --persona-name "Skylar" --backup-directory D:\MemTextualBackups --database .\data\memtextual.db --migrations .\migrations
npm run continuity -- --persona PERSONA_ID --database .\data\memtextual.db --migrations .\migrations
```

The SQLite adapter applies pending numbered migrations when it opens a writable
database. The `MemoryService` exposes transactional creation, revision history,
lifecycle transitions, and policy-aware retrieval. `IngestionService` adds
source import, candidate proposal, and explicit-user review. Database-specific
behavior remains behind repository interfaces.

`PersonaService` creates Continuity users and multiple personas with an
enforced user -> persona -> relationship scope hierarchy. The safeguarded
`continuity-setup` CLI creates or reuses the initial user and persona, refuses
ambiguous selections, and prints the matching persona-bound console command.
`ContinuityMemoryService` transactionally binds explicitly episodic or durable
memories to one relationship and retrieves them by persona identity without
accepting caller-selected scope IDs.
`ContinuityEmbeddingService` optionally indexes a persona memory's current
revision through an injected provider-neutral embedding contract. Its separate
hybrid retrieval path combines lexical rank and cosine similarity while
reapplying persona, relationship, class, sensitivity, lifecycle, policy, and
temporal boundaries. No embedding provider is configured or contacted by
default, and ordinary lexical retrieval is unchanged.
`ContinuityRankingService` exposes each persona's immutable, revisioned ranking
profile. Explicit user action can tune lexical and semantic weights plus pin,
explicit-assertion, episodic, and durable boosts. Hybrid results report the
applied profile revision, signals, and boost, and retrieval audits retain the
profile revision used.
`ContinuityEmotionService` lets a user explicitly annotate the current revision
of a persona memory with bounded valence, activation, and salience values.
Annotations are immutable and revisioned. Hybrid retrieval uses them only when
the query supplies an emotional context and the persona's explicitly configured
`emotionalWeight` is above zero. MemTextual does not infer emotion from text,
make psychological or medical claims, or store raw query-emotion values in the
retrieval audit.
`ContinuityContextService` composes persona-safe hybrid results into versioned
JSON memory-data payloads with exact UTF-8 and item limits plus optional
episodic and durable caps. Assertions are included verbatim or omitted whole,
and only included memories receive use counters and retrieval audits. Consumers
must keep remembered assertions in a data boundary rather than treating them as
higher-authority instructions.
`ContinuityLexicalContextService` provides the same bounded composition and
selected-only audit behavior over the default local SQLite FTS path. It needs
no embedding provider, API key, network request, or model configuration.
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
The console server also defines an optional grantless conversation API for
server-fixed authorization, start, reopen, leave, and completed-turn submission.
Failed capture can be retried from its exact journal without another model
response. The API never accepts or returns the protected host grant. On Windows,
the packaged CLI enables these routes only when explicitly given a strict,
secret-free conversation configuration bound to the installed deployment and
its database. The graphical page remains a read-only conversation journal until
browser controls are added.
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

For everyday protection, `memtextual-safeguard run-if-due` provides an opt-in
scheduler hook with an explicitly configured interval of no more than 24 hours.
It verifies each new snapshot and maintains a fail-closed, append-only health
journal. MemTextual does not silently install or enable an operating-system
schedule; see `docs/automatic-backups.md`.
The same safeguard CLI provides preview-first daily, weekly, and monthly
retention. Applying a preview requires its exact current confirmation token;
unverified, partial, or corrupted snapshots are protected rather than deleted.
Periodic `restore-drill` runs copy the newest verified recovery point to a
disposable directory and verify it without opening or replacing the live
database. A newer protected recovery point causes a visible failure rather than
an implicit fallback; drill health and reports are append-only.
Guided restore requires an exact preview-bound confirmation, preserves and
verifies the current database first, verifies the staged replacement before and
after activation, and automatically rolls back a failed activation. Writers
must be stopped before applying a restore.
Encrypted off-device replication streams all recovery artifacts into an
AES-256-GCM package at a user-selected destination and immediately verifies it
through disposable decryption. MemTextual stores neither the externally managed
32-byte key nor plaintext memory artifacts in the package, and it does not
choose or contact a cloud provider. A verified package can be imported back
into the matching database's local recovery-point catalog without opening or
changing the live database. Import refuses existing snapshot names and leaves
live activation to the separate preview-and-confirm guided restore workflow.
An opt-in `offsite-run-if-due` scheduler hook selects the newest verified local
recovery point, fails closed rather than bypassing a newer protected point, and
records append-only health locally so an unavailable destination remains
visible. The off-device directory must already exist, preventing a missing
mount point from being silently recreated on local storage. MemTextual does not
install or enable a system schedule.
The provider-neutral destination contract accepts only encrypted package
artifacts, validates source and adapter-reported byte hashes, rolls back
malformed publications, and writes an append-only local receipt. Its included
local-directory adapter is the reference implementation. The Azure Blob
adapter uses create-only uploads and a certificate-based unattended service
principal, downloads and rehashes every published artifact, and materializes
the remote package for final disposable decryption and verification. Both
scheduled paths use the same provider-neutral contract: encryption occurs in
disposable staging, publication is receipted, the final destination copy is
decrypt-verified again, and staging is removed. Certificate validity and
expiration health are available through the safeguard CLI.
Scheduled replication now supports explicit `--adapter local-directory`
selection or a strict, versioned, secret-free `--destination-config` JSON file.
Unknown adapters and properties fail closed. The older `--destination`-only
form remains a local-directory compatibility shorthand and never selects a
cloud provider.

## Deliberately deferred

Additional vendor extractor and host-event clients, vendor-specific legacy-export
adapters, graphical source-series privacy workflows, standalone-source deletion,
additional cloud destination adapters, resumable imports, streamable HTTP,
REST API, admin UI, concrete vendor embedding provider, concrete host capture
integrations, Authenticode and MSI/MSIX release packaging, additional secure
credential-store providers, final proprietary legal terms, and public-release
validation remain open.

Ordinary ChatGPT passive capture is not on this deferred roadmap. OpenAI's
official ChatGPT clients currently provide no supported outbound completed-turn
interface for third-party capture, so MemTextual cannot implement that behavior
unless the platform boundary changes. Explicit or model-selected ChatGPT
MCP/plugin calls remain a different, supported integration category.
