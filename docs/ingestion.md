# Source ingestion and candidate review

## Purpose

MemTextual places a provenance-aware review boundary between source material and durable memory:

```text
source -> ordered source records -> pending candidate -> explicit user review -> memory
```

Importing material does not automatically create a memory. Proposing a candidate also does not make it retrievable. Only acceptance creates an active memory and transfers the candidate's evidence links to its first revision.

## Source imports

`IngestionService.importSource` imports one source and at least one ordered record in a single transaction.

### Identity and idempotency

- The repository computes SHA-256 hashes; callers do not supply trusted hashes.
- The source hash covers the ordered record payload: kind, exact content, author fields, occurrence time, and recursively key-sorted metadata.
- The source envelope—title, origin URI, capture time, and source metadata—is descriptive and is not part of the content hash.
- Each record also receives a SHA-256 hash of its exact content.
- An import with `kind` plus `externalId` is idempotent when its computed source hash matches the existing source.
- Reusing the same `kind` plus `externalId` with different content fails unless the caller explicitly sets `createVersion: true`.
- Explicit version creation writes a new immutable source and records its predecessor; it never overwrites prior source material.
- A nonempty `versionReason` may be retained with the new version.
- Without an external ID, an active source with the same kind and content hash is reused.
- Records receive zero-based ordinals from their input array position.
- Record content is preserved exactly. Content containing only whitespace is rejected.

An external identity defines a source series. Its first import is version 1. A
changed import with `createVersion: true` becomes the next version and the
current member of that series. `listSources` returns only current sources;
`getSourceHistory` returns every version in chronological order. Every version
keeps its own source records, content hash, metadata, timestamps, and evidence
relationships.

## Candidate model

Migration `002_ingestion_candidates.sql` adds:

- `memory_candidates`: proposed memory fields, scope, review state, and accepted memory link;
- `candidate_evidence`: one or more source-record links with `supports`, `contradicts`, or `context` roles;
- `candidate_events`: append-only `proposed`, `accepted`, and `rejected` review events; and
- a partial uniqueness rule for active, external-ID-free sources by source kind and content hash.

Candidate states are:

```text
pending -> accepted
pending -> rejected
```

Accepted and rejected candidates are retained. They cannot be reviewed a second time.
Deleting an accepted memory retains its candidate lineage during the recoverable
period. Purging the memory removes candidates and resolutions that would retain
or reference the purged assertion.

Candidates may carry a stable external ID. Re-proposing the same external ID
with identical content reuses the existing candidate and its review state;
reusing it with different content fails. The legacy migration CLI uses this
identity to make reruns safe.

Every candidate requires:

- a nonempty assertion;
- one existing scope;
- one or more unique evidence links; and
- a confidence from 0 through 1.

Optional memory controls—retrieval policy, sensitivity, pinning, protection,
validity bounds, and a review date—are stored on the candidate and copied to the
accepted memory. Temporal timestamps are normalized to UTC, invalid or reversed
windows are rejected, and omitted bounds remain open-ended.

## Review authorization

Acceptance and rejection require both:

```ts
actor === "user" && explicitUserAction === true
```

`IngestionService` enforces the rule. `SqliteIngestionRepository` separately refuses candidate review by a non-user actor.

The local MCP server deliberately exposes no accept or reject tool. An MCP client can import sources, propose candidates, and inspect the queue, but cannot approve its own proposal. The local review CLI calls the service with explicit user authorization.

## Acceptance behavior

Candidate review supports six explicit outcomes: create, revise, reaffirm,
contradict, supersede, or ignore. Create and ignore retain the established
accept/reject behavior. The other outcomes require an explicit user action and
an active target memory of the same type in the candidate's scope. Resolution,
target, result, actor, note, and timestamp are retained in
`candidate_resolutions`.

MemTextual suggests deterministic exact matches when the candidate and an active
memory have equivalent normalized assertions after Unicode, case, punctuation,
and whitespace normalization. An optional provider-neutral matcher can add
advisory semantic duplicate, refinement, conflict, or related suggestions. Core
validation restricts providers to eligible same-type memories in the candidate
scope and requires a valid score, reason, matcher ID, and matcher version. These
suggestions never authorize automatic merging. No external provider adapter is
included or enabled by default; see `semantic-matching.md`.

Acceptance runs in one database transaction:

1. Verify that the candidate is pending.
2. Create the memory and its first revision with actor `user`.
3. Copy every candidate evidence link to that revision.
4. Mark the candidate accepted and link it to the memory.
5. Write the candidate acceptance event.

Any failure rolls back the memory, evidence, candidate state, and events.

Rejection preserves the candidate and evidence, records the review note, and writes a rejection event. It creates no memory.

## TypeScript surface

Portable types are in `src/domain/ingestion.ts`.

`IngestionService` exposes:

- `importSource`
- `listSources`
- `getSourceHistory`
- `getSourceRecords`
- `deleteSourceSeries`
- `restoreSourceSeries`
- `previewSourceSeriesPurge`
- `purgeSourceSeries`
- `proposeCandidate`
- `getCandidate`
- `getCandidateByExternalId`
- `listCandidates`
- `acceptCandidate`
- `rejectCandidate`

Storage behavior is isolated behind `IngestionRepository`. `SqliteIngestionRepository` uses the existing `MemoryRepository` during transactional acceptance.

Continuity ambient capture uses the same source and candidate boundary through
`AmbientMemoryService`. Its provider-neutral extractor contract can propose
episodic or durable memories only from records in the just-imported interaction.
The service selects the persona relationship scope and defaults extracted
claims to inferred, confidence `0.5`, and pending review. A configured versioned
sensitivity classifier may assess each proposal; without one, the candidate
fails closed to sensitive. Classification can raise but never lower an
extractor-declared sensitivity. See `ambient-memory.md`.

Authorized applications may deliver events through a versioned
`HostEventAdapter` only after an explicit user creates a persona-scoped grant.
Successful captures receive immutable, replay-protected receipts; unauthorized
events are rejected before adapter execution. See `host-capture.md`.

## MCP tools

The ingestion interface adds seven tools to the core memory tools:

| Tool | Behavior |
|---|---|
| `source_import` | Import or idempotently reuse a source; changed content requires explicit version creation. |
| `source_history` | List every immutable version for one external source identity. |
| `source_list` | List up to 100 recent active sources. |
| `source_records` | Read one source's ordered records. |
| `candidate_propose` | Create a pending candidate with source evidence. |
| `candidate_get` | Read one candidate and its review state. |
| `candidate_list` | List candidates, optionally filtered by status. |

MCP proposals are recorded with actor `system`. The tools cannot accept or reject candidates.

## Current trust boundary and limitations

The MCP transport is local stdio. Source and candidate reads do not have a separate sensitivity or authorization model. Do not expose this server remotely without first designing authentication and source-level access controls.

## Legacy-memory migration

Memories retained by an earlier agent or memory system use the same provenance
and candidate-review boundary as other imported material:

```text
legacy export -> source records -> pending candidates -> explicit review -> memories
```

The trusted local migration CLI:

- import the legacy collection as a source, normally using one ordered source
  record per prior memory;
- preserve available origin system, legacy identifier, creation or observation
  time, and export details as source or record metadata;
- propose each prior memory as a candidate linked to its imported source record;
- applies conservative defaults when authorship or explicitness cannot be
  established; and
- use the normal trusted review workflow so the user can accept, reject, skip,
  and inspect each candidate before it becomes retrievable memory.

The legacy memory text is evidence of what the earlier system stored, not proof
that its assertion is correct. Migration must not silently elevate uncertain
agent-generated summaries into explicit user statements.

Stable source and legacy-memory identifiers make reruns idempotent. Reusing an
identity with different content fails rather than rewriting provenance. Every
legacy candidate is flagged for manual review, so configured automation cannot
silently approve it.

Accepting a candidate creates a new memory and may duplicate or conflict with
an existing one. Automatic merging, revision, reaffirmation, contradiction, or
supersession decisions are not implemented.

See `docs/legacy-migration.md` for the JSON format, CLI command, defaults,
idempotency rules, and limitations.

## Configurable review policies

MemTextual provides versioned manual,
`automatic_explicit`, `automatic_threshold`, and `risk_based` policies. Policies
may be global or scope-specific; the narrowest active scope policy wins, and
missing or invalid configuration falls back to manual review.

The implementation includes trusted `(source kind, external ID)` identities,
trusted proposer identities reserved for local integrations, decision previews,
automatic system acceptance, retained evaluation details, and explicit
per-candidate bulk decisions. Policy configuration and bulk decisions are
available through the trusted local policy CLI, not MCP tools.

Manual-only guardrails cover inferred, sensitive, restricted, protected,
instruction, contradicting, explicitly flagged, exact-match, and untrusted
candidates. Without a trusted proposer, automatic acceptance also requires the
assertion to exactly match a supporting trusted source record. This prevents an
agent from attaching arbitrary assertions to otherwise trusted evidence.

See `docs/review-automation.md` for the exact policy schema, commands,
precedence, evaluation behavior, and audit contract.

Current limitations include:

- resumable imports;
- standalone-source deletion outside an external source series;
- an explicitly configured local or external semantic-provider adapter;
- a concrete ambient sensitivity-classification provider;
- additional vendor extraction providers and host-event subscription adapters;
- source-level sensitivity and redaction; and
- remote transport authentication and authorization.
