# Continuity user-control service

`ContinuityControlService` is the trusted library boundary for the local
graphical Continuity interface. It composes the existing persona, ingestion,
memory, and privacy services without weakening their policy checks.

## Persona boundary

Every queue, detail, and mutation request starts from a persona ID. Candidate
queues include only candidates with an `ambient_candidate_profiles` binding to
that persona; sharing a scope ID is not sufficient. Memory operations require a
matching `continuity_memory_profiles` row. Missing and cross-persona resources
receive the same not-found-style failure and are never returned to the caller.

Candidate review details include the candidate, its episodic or durable class,
resolved source records for every evidence link, and eligible matches that are
also Continuity memories for the selected persona. Missing retained evidence is
represented as `null` rather than replaced or invented.

## Explicit control

All mutations require `actor: "user"` and `explicitUserAction: true` at the
control boundary. This applies to:

- candidate resolution and rejection;
- direct persona-memory creation and revision;
- pinning, unpinning, protection, and unprotection;
- archive and restore;
- recoverable deletion and restoration;
- confirmed purge; and
- supersession and contradiction.

The underlying services and SQLite constraints continue to enforce their own
authorization, lifecycle, confirmation, and provenance rules. The control
service does not accept caller-selected scopes and cannot use a memory from
another persona as a resolution or relationship target.

## Current boundary

This service remains a library API and is not an MCP tool. The local Continuity
console uses it for its review queue and memory inspector without duplicating
policy rules. The console exposes candidate reconciliation and direct correction
through this boundary. It also packages a versioned persona-memory export and
exposes exact-ID-confirmed recoverable deletion and restoration. Confirmed purge
remains a later Phase 4 package.
