# Recoverable deletion and privacy purge

## Safety model

Archive is the default way to remove a memory from normal retrieval. It is
reversible and does not discard history.

Deletion and purge are separate, explicit user actions:

1. **Delete** creates a recoverable tombstone, records the prior lifecycle
   state and reason, and removes the memory's search document immediately.
2. **Restore deleted** returns the memory to its exact prior lifecycle state and
   rebuilds its search document.
3. **Purge** is permitted only after deletion and requires a second exact-ID
   confirmation. It physically removes the memory and its retained content from
   the active database.

System, extractor, import, and client actors cannot delete, restore a deleted
memory, or purge. Protected memories follow the same explicit-user boundary.
Tombstones that predate this workflow are recorded during migration with an
unknown prior state. They may be purged but cannot be automatically restored,
because inventing a prior lifecycle state would be unsafe.

## Purge scope

A memory purge transaction removes:

- the memory item and every immutable revision;
- memory evidence links, embeddings, scopes, entity links, and relationships;
- its search document and FTS entry;
- accepted candidates and candidate resolutions that retain or reference the
  purged memory;
- prior memory-linked audit events and deletion records; and
- any other rows removed by the schema's declared cascades.

The transaction then creates an assertion-free purge receipt and a `purged` audit
event. The receipt records the subject ID, reason, time, deleted-row counts, and
number of source records deliberately left in place. It does not retain the
memory assertion.

## Separate copies

Purging a memory does not silently delete source records. Source material can
support other memories and has its own provenance lifecycle. The read-only
purge preview lists retained source-record IDs so the user can decide whether a
separate source-level privacy operation is required.

Purge also cannot erase copies outside the active database, including database
snapshots, durable exports, filesystem copies, or off-device backups. Every
preview and receipt therefore reports `externalCopiesNotModified: true`.
Complete erasure requires applying the user's retention policy to those copies;
MemTextual must not claim otherwise.

## Source-series deletion and purge

An externally identified source and all its immutable versions are deleted and
restored as one series. Deletion tombstones every version and record while
retaining their exact prior deletion states, so restoration does not revive a
record that was already deleted for another reason. Imports cannot implicitly
reuse or resurrect a deleted series.

The source purge preview reports all versions, records, dependent memories,
dependent candidates, and active review policies that trust the source
identity. Purge is blocked until:

- the source series has first been recoverably deleted;
- no retained memory evidence depends on any record in the series; and
- no active review policy trusts the source kind and external ID.

Once unblocked and exactly confirmed, source purge removes the series, all
versions and records, deletion history, and remaining candidate lineage that
references those records. It writes an assertion-free source purge receipt.
Inactive historical policies remain intact but cannot authorize future review.

## Trusted local CLI

The MCP transport does not expose deletion or purge because it acts as the
system, not as an explicitly confirming user. Use the trusted local CLI:

```powershell
npm run privacy -- preview --id MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- delete --id MEMORY_ID --reason "User requested forgetting" --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- restore --id MEMORY_ID --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- purge --id MEMORY_ID --reason "User requested permanent removal" --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- source-preview --kind file --external-id SOURCE_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- source-delete --kind file --external-id SOURCE_ID --reason "User requested source deletion" --confirm SOURCE_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- source-restore --kind file --external-id SOURCE_ID --confirm SOURCE_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- source-purge --kind file --external-id SOURCE_ID --reason "User requested permanent source removal" --confirm SOURCE_ID --database .\data\memtextual.db --migrations .\migrations
```

Use a short operational reason; do not repeat sensitive memory content in the
reason because the purge receipt retains it.

## Graphical memory privacy controls

The local Continuity console exposes memory deletion, restoration, purge
preview, and confirmed purge. Deletion and restoration require the exact memory
ID in addition to an explicit button action; deletion also requires a short
operational reason. Purge additionally requires prior deletion, a fresh impact
preview, a reason, two explicit acknowledgements, and a final browser
confirmation. The server rechecks eligibility and uses the same service
transaction and persona boundary described above. Its response is the existing
assertion-free purge receipt.

The console does not automatically create a pre-purge backup because that would
create a new retained copy during an erasure request. It explicitly reports that
source records, exports, snapshots, filesystem copies, and off-device backups
are not modified.

## Current boundary

Memory and source-series deletion and purge are implemented. Verified local
snapshot retention is available through the separate preview-and-confirm
safeguard workflow; memory purge does not invoke it automatically. Standalone
sources without an external series identity, off-device retention, bulk
operations, and graphical source-series privacy controls remain separate work.
