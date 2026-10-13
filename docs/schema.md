# MemTextual schema

## Design goals

1. Keep original source material separate from extracted memories.
2. Preserve revision history while exposing one unambiguous current state.
3. Make provenance, confidence, and inference visible.
4. Support global, project, conversation, and custom namespace scopes.
5. Keep retrieval local and user-controlled by default.
6. Avoid coupling the domain model to an embedding vendor or server runtime.

## Conceptual model

```text
Source
  -> Source record
       -> Evidence link
            -> Memory revision
                 -> Memory item (current state)
                      -> Scope(s)
                      -> Entity link(s)
                      -> Memory relation(s)
                      -> Search document / embedding metadata
```

### Source and source record

A source identifies an imported conversation, file, manual entry, application,
or API payload. A source record is the smallest addressable piece of that
source, such as one chat message or one document section.

When a source has an external identity, `source_series` keeps that identity
stable and selects its current source. `source_versions` links every immutable
source in the series by version number and predecessor. Older versions and
their records remain addressable.

Source-series deletion tombstones every version and record while
`source_series_deletion_events` retains the exact prior deletion states needed
for restoration. Purge is blocked by retained memory evidence or an active
trusted-source policy, then removes the series and remaining candidate lineage
only after exact user confirmation. `source_purge_receipts` retains no source
content.

Source content is not itself a memory. It is evidence from which zero or more
memory revisions may be extracted.

### Memory item and memory revision

A memory item is the stable identity of a remembered concept. It holds its
current lifecycle state and user-control settings. A memory revision is an
immutable historical assertion about that concept.

`memory_items.current_revision_id` selects the revision used for retrieval.
The database requires that this revision belong to the same memory item.

Revisions may carry inclusive `valid_from` and `valid_to` bounds plus a
`review_after` hint. Migration 013 adds the review hint and the corresponding
candidate fields. It preserves existing revision bounds, leaves new candidate
bounds open, and marks no existing row due for review. The migration fails
without committing if it encounters invalid legacy revision bounds. Triggers
reject invalid timestamps and reversed validity windows on subsequent writes.

### Evidence

An evidence link joins a revision to a source record and says whether the
record supports, contradicts, or merely contextualizes the assertion. Exact
excerpts are optional because sensitive text should not be duplicated without
a reason.

### Scope

Scopes form a hierarchy. The built-in kinds are `global`, `project`,
`conversation`, and `namespace`. A memory can belong to several scopes, with
one marked primary.

Continuity uses additive identity tables rather than changing the original
scope kinds. `continuity_users` binds a local user to a root namespace scope.
Each `continuity_personas` row owns a namespace child of that user scope, and
its `continuity_relationships` row owns a namespace child of the persona scope.
Triggers enforce this topology and make bound ownership and scope identities
immutable. Different personas never share a relationship scope by default.

`continuity_memory_profiles` classifies a core memory as `episodic` or
`durable` and binds it to one user, persona, and relationship. This class is
orthogonal to `memory_type`: it describes persistence semantics rather than the
subject of the memory. Database triggers require the relationship scope to be
the memory's sole scope and reject cross-persona scope changes while the memory
is not deleted.

Continuity retrieval resolves the relationship scope from the persona identity
inside the repository. It then requires both the matching
`continuity_memory_profiles` row and its primary relationship-scope binding.
Callers cannot supply arbitrary scope IDs through this path.

`ambient_candidate_profiles` records the source, extractor identity and
version, persona relationship, and intended episodic or durable class for an
ambiently extracted candidate. Triggers require all candidate evidence to come
from that active source and require the candidate's scope and proposer to match
the recorded relationship and extractor. On acceptance, a trigger creates the
corresponding `continuity_memory_profiles` row in the same transaction.

Migration 012 extends each ambient profile with immutable sensitivity-assessment
provenance. New rows record whether assessment completed, declared and assessed
sensitivity, confidence, classifier ID/version, and machine-readable reason
codes. A trigger requires the candidate sensitivity to be at least as protective
as both inputs. Older schema-11 profiles remain `legacy_unassessed` rather than
being silently reclassified during migration.

Migration 014 adds `continuity_host_authorizations` and
`continuity_host_events`. An authorization binds a hashed one-time grant to one
user, persona relationship, host adapter, and event-kind allowlist. Identity
fields are immutable and status may only transition from active to revoked.
A successful host-event receipt binds one external event ID to its
authorization, adapter version, persona relationship, active source, and
ambient candidate IDs. Triggers reject expired or revoked authorization,
cross-persona receipts, candidates from another source, and receipt updates.

### Entity and relationship

Entities normalize people, organizations, projects, products, places, and
other named subjects. Memory relationships express semantic history across
items, including supersession and contradiction.

## Lifecycle rules

### Create

1. Store or identify the source and source record.
2. Create a memory item without a current revision.
3. Create its first revision and evidence links.
4. Point the item to that revision.
5. Assign at least one scope before making it retrievable.

### Edit or correct

- Never overwrite an earlier revision's assertion.
- Create a new revision with `previous_revision_id` set to the former current
  revision and an appropriate `change_kind`.
- Move `current_revision_id` to the new revision in the same transaction.
- Record the action in `audit_events`.

### Supersede

Use a new revision when the remembered concept remains the same. Use a new
memory item plus a `supersedes` relationship when the new assertion is a
distinct concept or decision. Mark the old item `superseded`; it remains
searchable for history but is excluded from normal retrieval.

### Contradict

Contradiction does not silently delete either assertion. Add a `contradicts`
relationship and evidence. If the conflict is unresolved, set the affected
item to `contradicted` so normal retrieval can treat it cautiously. If later
resolved, create a correcting revision or superseding item.

### Archive

Archived items remain intact but are excluded from normal retrieval. Archiving
is reversible.

### Delete

Deletion is a recoverable tombstone operation: set status to `deleted`, retain
the prior lifecycle state in `memory_deletion_events`, remove the search
document, and write an audit event. Explicit restoration rebuilds the search
document and returns the prior state.

Purge is separately authorized and physically removes a deleted memory's
revisions and active-database lineage. `privacy_purge_receipts` retains a
content-free operational receipt. Source records and external backups are
separate copies, so a memory purge reports them rather than claiming they were
erased. See `privacy.md`.

## Retrieval rules

A normal retrieval candidate must:

- have status `active`;
- have `retrieval_policy = 'include'`;
- have a current revision;
- match at least one allowed scope; and
- satisfy the caller's sensitivity policy; and
- fall within the current revision's validity window at the requested time,
  unless the caller explicitly includes out-of-window results.

Pinned items affect ranking, not access control. Protected items cannot be
automatically edited, superseded, archived, or deleted; explicit user action is
required. `exclude` is an absolute retrieval opt-out. `manual` means the item
is returned only when specifically requested.

Temporal filtering never changes lifecycle state or deletes a row. Explicit
out-of-window retrieval reports whether a result is `not_yet_valid`, `current`,
or `expired`; a due review date is reported separately and does not exclude the
memory.

## Confidence and extraction

Confidence ranges from 0 to 1 and describes extraction confidence, not whether
the assertion is objectively true. `explicitness` records whether the user or
source stated the assertion directly or an extractor inferred it.

## Search

`memory_search_documents` holds the provider-neutral text used for retrieval.
SQLite FTS5 indexes it. `memory_embeddings` stores embedding metadata and an
opaque vector reference, avoiding provider lock-in.

## SQLite-enforced invariants

- Enum-like values and confidence ranges are checked.
- Foreign keys and cascading behavior are explicit.
- Only one primary scope is allowed per memory.
- A memory cannot relate to itself.
- Current and previous revisions must belong to the expected memory.
- Source-series identities and version numbers are unique, and source-version
  predecessors cannot point to themselves.
- FTS rows track search-document inserts, updates, and deletes.

