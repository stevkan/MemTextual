# Persona foundations

MemTextual Continuity models the local user, each persona, and the relationship
between that user and persona as separate durable records with separate scopes.
These are the Phase 2 foundations used by the Phase 3 ambient-capture boundary.

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

## Persona-aware retrieval

`ContinuityMemoryService.retrieve` accepts a persona ID, search text, optional
memory classes, allowed sensitivities, an optional `asOf` time,
`includeOutOfWindow`, and a bounded result limit. It does not accept scope IDs.
The repository resolves the persona's relationship internally and searches only
active, included, profiled memories owned by that persona and bound to that
relationship's primary scope.

Normal sensitivity is the default. Both episodic and durable memories are
eligible unless the caller narrows the classes. Memories belonging to another
persona, unprofiled developer memories, excluded/manual memories, deleted or
archived memories, and disallowed sensitivities are not returned and do not
receive retrieval-use or audit events.

Default retrieval also excludes memories that are not yet valid or have
expired. An explicit out-of-window query returns them with a temporal status.
Overdue review dates are reported as `reviewDue` but do not suppress results or
change memory state.

The normal default applies to retrieval and explicit core-memory creation, not
unassessed ambient extraction. Ambient proposals without a completed
sensitivity assessment are marked sensitive and therefore excluded here by
default.

Every returned memory receives the normal retrieval counters and a client audit
event attributed to the resolved persona and relationship. Cross-persona shared
scopes remain unsupported and cannot be inferred by this API.

The optional Continuity hybrid path adds provider-neutral semantic matching and
an immutable ranking profile per persona. Ranking profiles can explicitly tune
lexical, semantic, pin, explicitness, episodic, durable, and emotional signals.
Emotional relevance is disabled by default. It uses only explicit user
annotations and explicit query context; it does not infer a user's emotional or
medical state from text.

## Current boundary

The current package establishes identities, isolated scope topology, explicit
episodic-versus-durable classification, persona-aware lexical and optional
hybrid retrieval, safeguarded first-run user and persona onboarding, and a local
Continuity control console. Persona management is available through the local
onboarding CLI but is not exposed through MCP. Hybrid retrieval, ranking
configuration, and emotional annotation are also not exposed through MCP;
authenticated distribution remains a later phase.
