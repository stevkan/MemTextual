# Recoverable deletion and memory purge

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

## Trusted local CLI

The MCP transport does not expose deletion or purge because it acts as the
system, not as an explicitly confirming user. Use the trusted local CLI:

```powershell
npm run privacy -- preview --id MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- delete --id MEMORY_ID --reason "User requested forgetting" --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- restore --id MEMORY_ID --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
npm run privacy -- purge --id MEMORY_ID --reason "User requested permanent removal" --confirm MEMORY_ID --database .\data\memtextual.db --migrations .\migrations
```

Use a short operational reason; do not repeat sensitive memory content in the
reason because the purge receipt retains it.

## Current boundary

This package implements memory deletion and memory purge. Source-series
deletion and purge, backup-retention enforcement, bulk operations, and a
graphical confirmation flow remain separate work.
