# Continuity ordinary ChatGPT tool contract

Status: required pre-release contract and server handlers implemented; the
authenticated ChatGPT transport is not yet implemented.

Contract version: 1.

## Purpose

Ordinary ChatGPT is a first-class explicit interface to MemTextual Continuity.
It can manage personas and perform persona-bound memory operations through a
dedicated Continuity MCP surface. It cannot observe completed ChatGPT turns and
must never describe these tools as passive capture.

The included Continuity client remains a separate, optional interface that adds
authorized completed-turn journaling and capture attempts.

## Boundary rules

- Every request is bound to the authenticated Continuity user.
- Persona tools return only personas owned by that user.
- Persona-bound tools accept a persona ID but never a user, relationship, or
  scope ID from the caller.
- The server resolves relationship and scope ownership internally and rejects
  cross-persona access with a not-found-style response.
- No global active persona is stored. ChatGPT resolves the persona for the
  current request and passes its ID to every persona-bound tool.
- `persona_memory_remember` is valid only for an explicit request to remember,
  save, or store information. It is not an ambient extraction entry point.
- A caller-requested sensitivity may only increase protection. Server-side
  assessment remains authoritative and must fail closed when missing.
- Mutating tools require an explicit-user-action boundary. Tool registration is
  blocked until the implementation can preserve that boundary.

## Required initial tools

| Tool | Purpose | Authorization |
|---|---|---|
| `continuity_profile` | Identify the connected user and disclose the explicit-only ChatGPT capture mode | Authenticated read |
| `persona_list` | List the connected user's personas and resolve names to stable IDs | Authenticated read |
| `persona_get` | Inspect one owned persona | Authenticated read |
| `persona_create` | Create a persona and its relationship scope hierarchy | Explicit user write |
| `persona_update` | Change mutable persona or relationship details without changing ownership or scopes | Explicit user write |
| `persona_behavior_get` | Read current user-authored persona behavior | Authenticated read |
| `persona_behavior_update` | Append a behavior revision or enable or disable behavior | Explicit user write |
| `persona_memory_remember` | Store information the user explicitly asked MemTextual to remember | Explicit user write |
| `persona_memory_search` | Retrieve relevant active memories under server-resolved persona policy | Authenticated read |
| `persona_memory_list` | List memories for one persona | Authenticated read |
| `persona_memory_get` | Inspect one persona memory | Authenticated read |
| `persona_memory_revise` | Correct or update a persona memory through an immutable revision | Explicit user write |
| `persona_memory_archive` | Remove a memory from active retrieval while keeping it recoverable | Explicit destructive write |
| `persona_memory_restore` | Restore an archived memory | Explicit user write |
| `persona_candidate_list` | List persona-bound review candidates | Authenticated read |
| `persona_candidate_get` | Inspect one candidate and its evidence | Authenticated read |
| `persona_candidate_accept` | Accept a candidate as a new persona memory | Explicit user write |
| `persona_candidate_ignore` | Resolve a candidate without creating or changing a memory | Explicit destructive write |

## Selection behavior

Persona selection is contextual rather than global. For a request such as
"Use Skylar and remember that I prefer morning appointments," ChatGPT first
calls `persona_list` when necessary, resolves the exact persona, and passes that
persona ID to `persona_memory_remember`. Selecting Skylar in one chat must not
change another chat's persona.

## Initial exclusions

The ordinary ChatGPT contract does not expose:

- passive ChatGPT turn capture;
- arbitrary user, relationship, or scope selection;
- persona deletion;
- recoverable memory deletion or permanent purge;
- conversation-journal purge;
- host-authorization management; or
- raw database, installation, backup, or credential paths.

These exclusions keep irreversible privacy actions and local-host administration
inside explicitly confirming local interfaces until a separate remote-safe
contract is approved.

## Implementation status

The catalog in `src/mcp/continuity-contract.ts` is descriptive and versioned.
The separate server in `src/mcp/continuity-server.ts` registers that complete
catalog and connects it to persona, behavior, memory, retrieval, lifecycle, and
candidate-review services. It is intentionally not registered by the existing
Developer MCP server.

The server accepts identity and explicit-user-action state only through an
injected trusted authorization resolver. It verifies persona ownership before
every persona-bound operation and requires a server-side sensitivity assessor
for direct memory creation. A requested sensitivity can raise protection but
cannot lower the assessed value.

The server is currently a library boundary only. No executable, package entry,
ordinary-ChatGPT registration, or network transport has been added. Activation
still requires an authenticated transport that constructs the trusted
principal and explicit-user-action state, followed by transport-level security
and interoperability validation.
