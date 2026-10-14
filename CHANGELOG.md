# Changelog

This file records user-visible changes to MemTextual. The files under `docs/`
describe only the current design and behavior.

## Unreleased

- Preserved the validated v0.8.0 baseline in a dedicated safety branch and tag.
- Added the initial MemTextual Continuity design and multi-persona isolation
  direction.
- Added consistent online database snapshots, portable durable-data exports,
  integrity manifests, post-upgrade content verification, and verification
  reports.
- Added tests that permit additive schema changes while detecting deleted or
  modified durable records.
- Added deterministic exact-normalized candidate matching and explicit create,
  revise, reaffirm, contradict, supersede, and ignore resolutions.
- Added immutable candidate-resolution records and upgraded the trusted review
  CLI to display matches and apply reconciliation choices.
- Added a provider-neutral semantic matcher contract with validated, attributed,
  advisory duplicate, refinement, conflict, and related suggestions.
- Added explicit immutable source versioning, stable source-series identities,
  retained version reasons, current-source listing, and complete source history.
- Added explicitly authorized recoverable memory deletion, exact-confirmation
  purge, assertion-free purge receipts, retained-copy disclosure, and a trusted
  local privacy CLI.
- Added reversible source-series deletion, dependency-aware purge previews,
  retained-memory and active-policy blockers, exact-confirmation source purge,
  and assertion-free source purge receipts.
- Added Continuity user identities, multiple personas per user, one relationship
  context per persona, transactional scope creation, and database-enforced
  user-to-persona-to-relationship scope ownership.
- Added explicit episodic and durable persona-memory profiles, transactional
  core-memory creation, strict single-relationship scope binding, and purge
  accounting for Continuity profiles.
- Added persona-aware retrieval that resolves relationship scope internally,
  enforces class and sensitivity filters, excludes unprofiled and cross-persona
  memories, and records use only for returned results.
- Added the provider-neutral ambient extraction contract and persona-bound,
  evidence-constrained, idempotent candidate capture with conservative defaults.
- Added database-enforced ambient provenance and transactional transfer of
  accepted candidates into episodic or durable persona-memory profiles.
- Added provider-neutral, versioned ambient sensitivity assessment with
  immutable classifier provenance and machine-readable reason codes.
- Changed unassessed ambient capture to fail closed as sensitive, prevented
  classifiers from lowering declared protection, and enforced both rules in
  the database while preserving schema-11 candidate state.
- Added normalized temporal validity windows and non-destructive review dates
  to candidates and immutable memory revisions, preserving schema-12 data.
- Changed core and persona retrieval to exclude out-of-window memories by
  default while supporting explicit as-of history with temporal and review-due
  status; expiration never mutates or deletes memory state.
- Added strict asynchronous structured-output extraction-provider adapters.
- Added explicit user-issued, persona-scoped host authorizations whose bearer
  grants are stored only as hashes and can be revoked or time-limited.
- Added versioned host-event adapters, deterministic replay protection, and
  immutable successful-capture receipts tied to source and candidate
  provenance.
- Added a persona-scoped Continuity control service for ambient review queues,
  resolved evidence, candidate reconciliation, memory history, correction,
  lifecycle, and privacy operations.
- Added explicit audited pinning and protection mutations and required explicit
  user action for every Continuity control change.
- Added a dependency-free local Continuity control console with a persona-bound
  review queue, evidence and history inspection, candidate acceptance or
  rejection, and pin, protect, archive, and restore controls.
- Bound the console to IPv4 loopback with per-launch bearer authorization,
  same-origin mutation checks, host validation, restrictive browser headers,
  and a token that is delivered in and removed from the URL fragment.
- Added graphical candidate match inspection and explicit revise, reaffirm,
  contradict, supersede, and ignore reconciliation controls with same-persona
  target enforcement.
- Added graphical direct correction that creates an immutable corrected revision
  and clears stale normalized text while preserving prior revision history.
- Added a versioned, persona-isolated JSON memory export containing current
  profiles and complete immutable revision histories without claiming to be a
  database backup or provenance-complete export.
- Added graphical recoverable deletion and restoration with a required reason,
  exact-ID confirmation, explicit user action, and the existing transactional
  tombstone safeguards.
- Added graphical memory-purge preview and confirmed purge with prior-deletion
  enforcement, a fresh server-side eligibility check, exact-ID confirmation,
  separate permanence and external-copy acknowledgements, final browser
  confirmation, and the existing assertion-free receipt.
- Added opt-in provider-neutral embedding generation and persona-safe hybrid
  retrieval with validated vectors, revision-bound derived storage, bounded
  candidate selection, and unchanged lexical retrieval defaults.
- Added immutable per-persona ranking profiles with explicit-user configuration,
  optimistic revision checks, explainable pin, explicit-assertion, episodic, and
  durable boosts, retrieval audit attribution, and safeguard coverage.
- Added explicit, revision-bound emotional annotations using bounded valence,
  activation, and salience values; emotional ranking is disabled by default,
  omits raw context from audits, rejects stale revisions, and participates in
  safeguards and permanent-purge accounting.
- Added persona-scoped bounded context composition with versioned memory-data
  JSON, exact UTF-8 and item limits, optional episodic and durable caps, and
  whole-item omission instead of assertion truncation.
- Changed hybrid retrieval accounting so normal retrieval still records every
  returned result while context composition records only memories actually
  included in the final payload.
- Added opt-in everyday backup orchestration with an explicitly configured
  interval of no more than 24 hours, post-creation manifest verification,
  concurrency locking, and a fail-closed append-only health journal.
- Added user-visible automatic-backup status for never-run, healthy, overdue,
  and failed states without silently installing or enabling a system schedule.
- Changed snapshot creation to refuse reuse of an existing timestamp directory
  rather than risk writing into an earlier recovery point.
- Added preview-first daily, weekly, and monthly backup retention with explicit
  timezone and week-boundary configuration, unconditional newest-snapshot
  preservation, and exact current-preview confirmation.
- Retention protects incomplete, corrupt, source-mismatched, or unverified
  recovery points; application shares the backup lock, validates direct
  non-link targets, and retains planned-operation and completion records.
- Added interval-based restore drills that verify the newest recovery point in
  a disposable copy without opening or replacing the live database.
- Restore-drill state and reports are append-only and fail closed when a newer
  recovery point is corrupt or incomplete rather than silently using an older
  snapshot.
- Added guided live-restore preview and apply commands with confirmation bound
  to the selected recovery point and current logical database contents.
- Live restore creates and verifies a pre-restore recovery point, stages and
  verifies the replacement, preserves database sidecars, rolls back activation
  failures, and records planned, completed, and cleanup evidence.
- Added provider-neutral encrypted replication to an explicitly selected
  destination using streamed AES-256-GCM, per-file HKDF-SHA-256 keys, fresh
  nonces, and authenticated package metadata.
- Encrypted packages are decrypt-verified in a disposable directory before
  success; wrong keys, altered ciphertext, unsafe destinations, and unverified
  local recovery points fail closed without storing the master key.
- Added authenticated off-device package import into the matching local
  recovery-point catalog after disposable decryption and full verification.
- Import shares the safeguard lock, refuses identity mismatches and existing
  snapshot names, records planned, success, or failure evidence, and never
  opens or changes the live database.
- Added an opt-in encrypted off-device `run-if-due` scheduler hook and status
  command with an explicit interval and destination.
- Scheduled replication selects the newest verified local recovery point,
  fails closed for newer protected points, and records append-only local health
  so destination failures remain visible without storing keys or assertions.
- Replication now requires its direct destination directory to exist, avoiding
  accidental local writes when an intended removable or mounted destination is
  unavailable; status reports destination and last-package availability.

## 0.8.0 - 2026-10-12

- Added the trusted local `memtextual-migrate` CLI and a versioned JSON export
  format for importing memories retained by earlier systems.
- Added one-to-one source-record and candidate creation with preserved legacy
  identity, timestamps, authorship, origin, and metadata.
- Added conservative defaults and mandatory manual-review flags so migration
  cannot silently convert legacy assertions into retrievable memories.
- Added stable candidate external IDs and conflict-safe, idempotent reruns.
- Added schema migration 004 and reported legacy migration as an implemented
  CLI capability through `server_info`.

## 0.7.0 - 2026-10-12

- Added immutable, versioned global and scope-specific candidate-review policies.
- Added `manual`, `automatic_explicit`, `automatic_threshold`, and `risk_based`
  review modes with fail-closed guardrails.
- Added trusted source and trusted proposer configuration.
- Added policy preview, pending-candidate processing, and explicit bulk accept
  and reject operations through the trusted local `memtextual-policy` CLI.
- Added retained policy-evaluation details to candidate audit events.

## 0.6.0 - 2026-10-12

- Added the read-only `server_info` MCP tool.
- Added server identity, version, capability status, and a complete tool catalog
  with safety annotations.
- Kept database contents, credentials, and local runtime paths out of discovery
  responses.

## 0.5.0 - 2026-10-12

- Added the trusted local `memtextual-review` CLI for accepting, rejecting,
  skipping, and inspecting pending candidates.
- Added complete source-record evidence display and optional review notes.
- Added `IngestionService.getSourceRecord` and the `source_record_get` MCP tool.

## 0.4.0 - 2026-10-12

- Added atomic, SHA-256-idempotent source and source-record imports.
- Added pending memory candidates linked to retained evidence.
- Added explicit-user candidate acceptance and rejection with audit history.
- Added transactional acceptance that creates a memory and transfers provenance.
- Added six MCP tools for source import, candidate proposal, and queue inspection.

## 0.3.0 - 2026-10-7

- Added the local stdio MCP server using the official TypeScript SDK.
- Added eleven validated tools for scopes, memory storage, retrieval, and
  lifecycle operations.
- Added configurable database and migration paths and the `memtextual-mcp`
  executable.
- Added in-memory protocol coverage and a real stdio handshake test.

## 0.2.0 - 2026-10-7

- Added the storage-neutral `MemoryService` and repository contracts.
- Added immutable revision history and lifecycle operations.
- Added protected-memory authorization, scope and sensitivity filtering,
  pinned-result ranking, usage tracking, and retrieval audits.

## 0.1.0 - 2026-10-7

- Added the initial SQLite schema and migration runner.
- Added source provenance, scoped and revisioned memories, lifecycle relations,
  entity links, FTS5 search data, embedding metadata, and audit events.
- Added representative seed data.
