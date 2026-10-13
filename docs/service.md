# Memory service

## Purpose

`MemoryService` is the application boundary between MemTextual's storage layer
and future transports such as MCP or REST. Callers use domain objects and do not
depend on SQLite.

## Operations

```ts
create(input: CreateMemoryInput): Memory;
getById(id: string): Memory | null;
getHistory(id: string): MemoryRevision[];
revise(id: string, input: ReviseMemoryInput, context?: MemoryMutationContext): Memory;
archive(id: string, context?: MemoryMutationContext): Memory;
restore(id: string, context?: MemoryMutationContext): Memory;
delete(id: string, input: DeleteMemoryInput, context?: MemoryMutationContext): Memory;
restoreDeleted(id: string, context?: MemoryMutationContext): Memory;
previewPurge(id: string): MemoryPurgePreview;
purge(id: string, input: PurgeMemoryInput, context?: MemoryMutationContext): MemoryPurgeReceipt;
supersede(id: string, replacementId: string, context?: MemoryMutationContext): Memory;
contradict(id: string, contradictingId: string, context?: MemoryMutationContext): Memory;
retrieve(query: RetrievalQuery): RetrievalResult[];
```

## Revision behavior

A revision creates a new immutable `memory_revisions` row and points the memory
item at it. The previous revision remains available through `getHistory`.

Omitted `normalizedAssertion`, `explicitness`, `confidence`, and `observedAt`
values inherit from the current revision. Supplying `null` for nullable fields
clears them. Each revision updates the FTS search document and writes a
`revised` audit event in the same transaction.

## Protected memories

A protected memory can be revised or moved through its lifecycle only when both
conditions are true:

- the actor is `user`; and
- `explicitUserAction` is `true`.

Extractor, system, and import actors cannot bypass protection by setting the
flag. This rule is enforced by the service and checked again by the SQLite
repository during the transaction.

## Lifecycle behavior

- `archive` moves an active memory to `archived`.
- `restore` moves an archived memory back to `active`.
- `supersede` marks the old memory `superseded` and records a `supersedes`
  relation from the replacement to the old memory.
- `contradict` marks the old memory `contradicted` and records a `contradicts`
  relation from the contradicting memory to the old memory.

Each transition is transactional and produces a corresponding audit event.

## Deletion and purge

Archive remains the default reversible removal. Delete, restore-deleted, and
purge require `actor === "user"` and `explicitUserAction === true` regardless of
protection status. Delete creates a recoverable tombstone and removes the search
document. Restore returns the exact prior lifecycle state. Purge requires an
already-deleted memory plus an exact memory-ID confirmation and removes its
active-database lineage transactionally. See `privacy.md` for retained-copy
boundaries.

## Retrieval policy

Normal retrieval requires all of the following:

- a non-empty full-text query;
- at least one caller-authorized scope;
- status `active`;
- retrieval policy `include`; and
- sensitivity included in the caller's allowed sensitivity set.

If no sensitivity set is supplied, only `normal` memories are eligible. Scope
matching is exact; hierarchical scope inheritance is not implemented.

Matching pinned memories sort ahead of matching unpinned memories. FTS relevance
and update time break ties. Returned results have one-based ranks. Every result
increments its use count, updates its last-used time, and writes a `retrieved`
audit event in the same transaction.

## Current limitations

The following are not implemented:

- automatic extraction;
- hierarchical scope expansion;
- semantic or hybrid vector ranking;
- pin, protection, retrieval-policy, sensitivity, and scope mutation APIs;
- REST and administrative UI adapters.
