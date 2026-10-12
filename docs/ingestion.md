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
- Reusing the same `kind` plus `externalId` with different content fails. MemTextual never overwrites or silently versions source material.
- Without an external ID, an active source with the same kind and content hash is reused.
- Records receive zero-based ordinals from their input array position.
- Record content is preserved exactly. Content containing only whitespace is rejected.

Changing an existing external source requires a new external ID. Explicit source-version relationships are not implemented.

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
An accepted memory cannot be deleted while its retained candidate still references it; future purge semantics must resolve that lineage explicitly.

Every candidate requires:

- a nonempty assertion;
- one existing scope;
- one or more unique evidence links; and
- a confidence from 0 through 1.

Optional memory controls—retrieval policy, sensitivity, pinning, and protection—are stored on the candidate and copied to the accepted memory.

## Review authorization

Acceptance and rejection require both:

```ts
actor === "user" && explicitUserAction === true
```

`IngestionService` enforces the rule. `SqliteIngestionRepository` separately refuses candidate review by a non-user actor.

The local MCP server deliberately exposes no accept or reject tool. An MCP client can import sources, propose candidates, and inspect the queue, but cannot approve its own proposal. The local review CLI calls the service with explicit user authorization.

## Acceptance behavior

Acceptance always creates a new memory. Matching a candidate to an existing memory and choosing revision, reaffirmation, contradiction, or supersession is not implemented.

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
- `getSourceRecords`
- `proposeCandidate`
- `getCandidate`
- `listCandidates`
- `acceptCandidate`
- `rejectCandidate`

Storage behavior is isolated behind `IngestionRepository`. `SqliteIngestionRepository` uses the existing `MemoryRepository` during transactional acceptance.

## MCP tools

The ingestion interface adds six tools to the core memory tools:

| Tool | Behavior |
|---|---|
| `source_import` | Import or idempotently reuse a source and ordered records. |
| `source_list` | List up to 100 recent active sources. |
| `source_records` | Read one source's ordered records. |
| `candidate_propose` | Create a pending candidate with source evidence. |
| `candidate_get` | Read one candidate and its review state. |
| `candidate_list` | List candidates, optionally filtered by status. |

MCP proposals are recorded with actor `system`. The tools cannot accept or reject candidates.

## Current trust boundary and limitations

The MCP transport is local stdio. Source and candidate reads do not have a separate sensitivity or authorization model. Do not expose this server remotely without first designing authentication and source-level access controls.

## Legacy-memory migration requirement

**Status: Confirmed design decision, not implemented as a dedicated importer.**
Memories retained by an agent or another memory system before MemTextual was
introduced should be migrated through the same provenance and candidate-review
boundary as other imported material:

```text
legacy export -> source records -> pending candidates -> explicit review -> memories
```

The migration workflow should:

- import the legacy collection as a source, normally using one ordered source
  record per prior memory;
- preserve available origin system, legacy identifier, creation or observation
  time, and export details as source or record metadata;
- propose each prior memory as a candidate linked to its imported source record;
- classify authorship and explicitness conservatively when the original user or
  agent provenance cannot be established; and
- use the normal trusted review workflow so the user can accept, reject, skip,
  and inspect each candidate before it becomes retrievable memory.

The legacy memory text is evidence of what the earlier system stored, not proof
that its assertion is correct. Migration must not silently elevate uncertain
agent-generated summaries into explicit user statements.

The initial migration path may compose the existing `source_import`,
`candidate_propose`, and review CLI operations. A dedicated importer or
conversion command remains future work and should be idempotent where the
source export provides a stable identity.

Until candidate deduplication and conflict matching are implemented, migration
must warn that accepting a candidate creates a new memory and may duplicate or
conflict with an existing one. Automatic merging, revision, reaffirmation,
contradiction, or supersession decisions remain out of scope for the initial
migration workflow.

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

- source version relationships and resumable imports;
- source deletion and privacy purge semantics;
- semantic candidate deduplication and matching to existing memories;
- revise/reaffirm/contradict/supersede choices during acceptance;
- a graphical review interface beyond the local CLI;
- automatic extraction-provider integration;
- source-level sensitivity and redaction; and
- remote transport authentication and authorization.
