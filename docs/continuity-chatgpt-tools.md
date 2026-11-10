# Continuity ordinary ChatGPT tool contract

Status: required pre-release contract, server handlers, and provider-neutral
authenticated HTTP boundary implemented; concrete identity-provider
integration, token verification, hosting, ChatGPT registration, and
interoperability validation remain.

Contract version: 2.

## Purpose

Ordinary ChatGPT is a first-class explicit interface to MemTextual Continuity.
It can manage personas and perform persona-bound memory operations through a
dedicated Continuity MCP surface. It cannot observe completed ChatGPT turns and
must never describe these tools as passive capture.

The included Continuity client remains a separate, optional interface that adds
authorized completed-turn journaling and capture attempts.

## Boundary rules

- Every request is bound to the authenticated Continuity user.
- Read tools require `continuity.read`; write tools require `continuity.write`.
- The HTTP boundary rejects missing, expired, or wrong-audience bearer tokens
  before MCP request handling.
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
- Mutating tools require a separate trusted explicit-user-action decision;
  OAuth authentication or scope alone does not satisfy that boundary.

## Required initial tools

| Tool | Purpose | Authorization |
|---|---|---|
| `continuity_profile` | Return the connected user's standard ChatGPT profile identity | Authenticated read |
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

Archive is the recommended ordinary-ChatGPT action when a user wants a memory
removed from active retrieval. It is reversible and does not erase stored data.
If the user asks for recoverable deletion or permanent purge, ChatGPT must
explain that the action is available in the local Continuity client and must not
present archive as deletion. The client retains the existing preview and exact
confirmation boundaries for irreversible purge.

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
cannot lower the assessed value. The profile tool returns OpenAI's standard
top-level profile shape and is marked with `openai/profile` metadata.

`src/mcp/continuity-http.ts` adds a provider-neutral Streamable HTTP boundary.
It publishes OAuth discovery metadata, verifies bearer-token expiry and
resource audience, advertises per-tool OAuth scopes, resolves the trusted
Continuity principal, and requires a separate injected policy for explicit
write authorization. It does not implement an authorization server, select an
identity provider, start a listener, or expose a public endpoint.

The private-UAT write policy trusts only explicitly configured OAuth client
IDs, requires the verified `continuity.write` scope, and accepts writes only on
an exact MCP `POST` resource. This policy relies on the trusted ChatGPT client
to obtain the user's built-in write confirmation; OAuth does not prove an
individual per-call confirmation to MemTextual. Unknown clients, read-only
tokens, other resources, and non-POST requests remain denied. Permanently
destructive privacy operations remain absent from the remote tool contract.

The remote deployment configuration is a strict, secret-free JSON document.
It records the exact Auth0 HTTPS issuer, exact public HTTPS origin, fixed local
loopback port, and an explicit write mode. `deny` keeps the remote tool surface
read-only. `trusted_oauth_client` requires one or more exact OAuth client IDs;
unknown properties, embedded client secrets, non-HTTPS origins, unstable port
zero, duplicate client IDs, and an empty trust list are rejected. The MCP
resource is derived as `/mcp` under the configured public origin rather than
being independently configurable.

`memtextual-continuity-remote` is the dedicated private-UAT executable. It
loads the saved Continuity installation profile for the existing database,
migrations, working directory, and configured Codex extraction model; validates
live Auth0 discovery; and starts the authenticated MCP application only on the
configured IPv4 loopback port. It prints the local tunnel target and public MCP
resource but does not start, configure, or authenticate Cloudflare Tunnel.

`memtextual-continuity-tunnel create` writes a new Cloudflare named-tunnel
configuration without overwriting an existing file. The generated ingress maps
only the configured public hostname to the fixed `127.0.0.1` Continuity port and
ends with an HTTP 404 fallback. Tunnel creation, DNS routing, authentication,
credential-file protection, service installation, and process startup remain
explicit Cloudflare administration steps.

Before an Auth0 account can resolve Continuity data, the local
`memtextual-continuity-identity` command requires a preview followed by the
exact current confirmation. It binds the verified Auth0 issuer and subject to
the existing user from the saved installation profile. Preview output contains
only the issuer and a subject-derived hash; the raw subject is neither echoed
nor stored, and an identity cannot be reassigned to another user.

`ContinuityIdentityBindingService` and `ContinuityBoundMcpPrincipalResolver`
provide the durable subject-to-user boundary. They store only the exact issuer
and a SHA-256 key derived from the verified issuer and opaque subject; the raw
subject and bearer token are not persisted. Bindings cannot be reassigned or
deleted, and explicit revocation permanently blocks resolution.

Private-UAT activation now uses the implemented Auth0 verifier and Cloudflare
named-tunnel configuration boundary. It still requires user-owned Auth0 tenant
and API settings, a user-created Cloudflare tunnel and DNS route, exact local
configuration, identity binding, ordinary ChatGPT registration, and live
interoperability validation. OpenAI recommends using an established identity
provider instead of building a new authorization server; ChatGPT's MCP
authentication uses authorization code with PKCE.
[OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth)
