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
