# Persona foundations

MemTextual Continuity models the local user, each persona, and the relationship
between that user and persona as separate durable records with separate scopes.
These are the first Phase 2 foundations; they do not yet perform ambient capture
or persona-aware retrieval.

## Scope hierarchy

Creating a Continuity user creates a root `namespace` scope. Creating a persona
for that user atomically creates both a persona scope and a relationship scope:

```text
user scope
  -> persona scope
       -> relationship scope
```

Each persona receives a distinct relationship scope. Two personas owned by the
same user therefore have no shared relationship scope by default. A future
explicit shared-scope feature may add controlled sharing; it must not infer or
silently create cross-persona access.

Database triggers enforce the hierarchy and prevent a bound scope from being
reparented or changed to another scope kind. Persona ownership, relationship
ownership, and their bound scope identities are immutable.

## Creation contract

`PersonaService` and `PersonaRepository` provide:

- `createUser`, `getUser`, and `listUsers`;
- `createPersona`, which also creates its one relationship context;
- `getPersonaContext`; and
- `listPersonas` for one user.

User, persona, relationship, and scope creation is one transaction. A duplicate
persona name or other constraint failure rolls back every new row, including
the provisional scopes. Persona names are unique per user without regard to
case. Optional external persona IDs are also unique per user.

Metadata is JSON object data. It may hold provider-neutral descriptive settings,
but credentials and sensitive secrets do not belong there.

## Persona memory classes

`ContinuityMemoryService` creates a core memory and its persona profile in one
transaction. The caller must explicitly choose one of two orthogonal classes:

- `episodic`: a bounded event, interaction, or experience; or
- `durable`: stable personal knowledge intended to remain useful across future
  interactions.

The class does not replace the core memory type, lifecycle, sensitivity, or
retrieval policy. For example, a preference can be durable while a task-context
memory can be episodic.

Every profiled memory is created in exactly one persona relationship scope.
Database triggers reject attaching another relationship scope, moving the
binding to another persona, or removing the active memory's required binding.
Permanent memory purge removes the profile and records it in the purge receipt.

## Current boundary

The current package establishes identities, isolated scope topology, and
explicit episodic-versus-durable classification through the TypeScript library.
It does not expose persona management through MCP. The next Phase 2 package will
add a Continuity retrieval path that accepts a persona identity instead of
arbitrary scope IDs.
