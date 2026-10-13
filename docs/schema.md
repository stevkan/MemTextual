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

Source content is not itself a memory. It is evidence from which zero or more
memory revisions may be extracted.

### Memory item and memory revision

A memory item is the stable identity of a remembered concept. It holds its
current lifecycle state and user-control settings. A memory revision is an
immutable historical assertion about that concept.

`memory_items.current_revision_id` selects the revision used for retrieval.
The database requires that this revision belong to the same memory item.

### Evidence

An evidence link joins a revision to a source record and says whether the
record supports, contradicts, or merely contextualizes the assertion. Exact
excerpts are optional because sensitive text should not be duplicated without
a reason.

### Scope

Scopes form a hierarchy. The built-in kinds are `global`, `project`,
`conversation`, and `namespace`. A memory can belong to several scopes, with
one marked primary.

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

Deletion is a tombstone operation: set status to `deleted`, set `deleted_at`,
remove the search document and embeddings, and write an audit event. The
application may then purge assertion or source content when privacy policy or
user intent requires it. It must not claim erasure until all retained copies,
backups, and indexes have been handled.

## Retrieval rules

A normal retrieval candidate must:

- have status `active`;
- have `retrieval_policy = 'include'`;
- have a current revision;
- match at least one allowed scope; and
- satisfy the caller's sensitivity policy.

Pinned items affect ranking, not access control. Protected items cannot be
automatically edited, superseded, archived, or deleted; explicit user action is
required. `exclude` is an absolute retrieval opt-out. `manual` means the item
is returned only when specifically requested.

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

