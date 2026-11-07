# Conversation hosts

MemTextual Continuity uses the provider-neutral `ConversationHost` interface to
keep its future conversational client independent from a particular model host.
The boundary deals only with conversations and completed turns; persona
selection, context composition, ambient extraction, memory policy, and storage
remain MemTextual responsibilities.

## Contract

A conversation host can:

- start a conversation and return an opaque host-assigned identifier;
- apply an optional persona-behavior prompt when the conversation is created;
- resume a known conversation;
- submit one text turn and stream typed lifecycle events;
- return the authoritative completed assistant text;
- list exact completed-turn history with completion time and memory-context
  identifiers; and
- close its local resources.

Only one turn may be active for a conversation at a time. Host conversation and
turn identifiers are opaque. A failed or interrupted turn is rejected and is
not represented as completed dialog.

Persona behavior uses the versioned `memtextual.persona_behavior` contract. It
is explicit user-controlled configuration, not remembered data, and is bound to
the selected persona before reaching the host. A host adapter must keep it
separate from turn text and memory context. The contract does not grant tool
use, data access, system changes, or changes to MemTextual memory policy.

## Initial Codex App Server adapter

`CodexAppServerConversationHost` is the only concrete implementation in the
initial scope. It starts `codex app-server` as a child process and communicates
over its default newline-delimited JSON stdio transport. It performs the
required `initialize`/`initialized` handshake, then maps:

- conversation creation to `thread/start`;
- conversation resumption to `thread/resume`;
- turn submission to `turn/start`;
- paginated completed-turn history to `thread/turns/list` with full items;
- streamed assistant text to `item/agentMessage/delta`; and
- authoritative assistant text and completion to `item/completed` and
  `turn/completed`.

At thread creation, the adapter always uses Codex App Server's stable
`developerInstructions` field to explain the Continuity integration boundary:
MemTextual evaluates a completed turn after the model responds, and the model
cannot observe or control the resulting storage decision. The model is told not
to claim that a memory was saved, rejected, unavailable, or read-only; the
Continuity client reports capture and review state instead.

When optional persona behavior is enabled, the adapter appends its versioned
contract after that integration notice. It prefixes the serialized contract
with its authority limits and preserves the user-authored instruction text
exactly. A neutral conversation receives the integration notice without a
persona-behavior contract.

Production construction requires an explicit absolute working directory. The
adapter also supplies that directory to `thread/start` so a Continuity
conversation does not silently inherit instructions or context from whichever
project happened to launch it. Managed Continuity setup creates a dedicated
non-project conversation directory for this purpose, and Windows host
provisioning can apply the configured protection boundary to that path.

The adapter does not infer completion from accumulated deltas. It accepts final
assistant content only from completed agent-message items and resolves a turn
only after a successful completed-turn notification.

When bounded MemTextual context is supplied, the adapter places it in a
separate text item with an explicit untrusted-memory-data warning and preserves
the current user text as its own item. Continuity turns use the no-approval
`memtextual-continuity` permission profile. It denies filesystem-root access,
permits only Codex's minimal runtime paths, disables command network access,
and never asks the user to authorize an action. On native Windows, the adapter
requires Codex's MXC sandbox rather than widening this boundary for the legacy
`elevated` sandbox.

The current adapter does not handle approval or other server-initiated
requests. It returns a method-not-supported error so an unexpected request
fails closed instead of hanging. It also does not expose stderr, add credentials
to command arguments, or persist protocol traffic.

The adapter also exposes a Codex-specific structured-task operation outside the
provider-neutral `ConversationHost` interface. The ambient extraction provider
uses it to create an ephemeral thread with dedicated developer instructions and
apply `outputSchema` only to that extraction turn. Structured tasks retain the
same no-approval, no-readable-root sandbox, and only authoritative completed
assistant content is returned.

If the child process exits, every in-flight request and turn fails. A later
operation starts and initializes a fresh process; the caller must explicitly
resume its known conversation before continuing it. Closing the adapter is
terminal.

History reads use the stable paginated API documented by
[OpenAI's Codex App Server guide](https://learn.chatgpt.com/docs/app-server),
not deprecated full-history resume responses. The adapter requests oldest-first
full items and reconstructs only completed turns containing exactly one
recognizable MemTextual memory envelope, one text user message, an authoritative
assistant response, and a recorded completion timestamp. Missing or ambiguous
content, unknown phases, duplicate turns, changed ordering, repeated cursors,
and unsupported input types fail the complete read before reconciliation.

Codex App Server protocol-specific behavior is isolated in this adapter. The
automated tests use a fake JSONL process to cover the handshake, thread creation
and resumption, ephemeral structured tasks, turn submission, streaming,
authoritative completion, request and turn errors, malformed data, concurrency,
process failure, and restart.

## Current boundary

The trusted Continuity runtime composition is implemented. It combines the
Codex conversation host, bounded persona memory context, optional explicit
persona behavior, structured extraction and sensitivity classification,
authorized ambient capture, the durable conversation journal, protected grant
resolution, and the grantless client facade. The Windows composition resolves
bearer grants through the DPAPI-backed store without exposing them to the
browser or accepting them from browser requests.

The token-protected loopback client can explicitly create and revoke host
authorizations, start conversations, reopen them through authoritative-history
reconciliation, send turns, leave local readiness, and retry failed capture
without generating another model response. An authoritative completed response
is journaled and displayed before extraction, classification, candidate
creation, and review automation finish. These steps continue in a tracked
background capture task; another turn remains blocked until that task reaches a
durable success or recoverable failure state.

The same persona-bound interface exposes candidate provenance and review,
persisted persona-behavior controls, exact local conversation journals,
preview-bound external host-thread deletion, and a separate preview-bound local
journal purge. Failed capture can be retried, and missing journal entries can
be reconstructed idempotently from authoritative host history without asking
the host to regenerate a response. External host deletion and active-database
journal purge remain separate because neither operation removes retained
backups, exports, or other external copies.

OpenAI Responses API hosting, bring-your-own-key configuration,
MemTextual-managed inference, other cloud providers, and local models remain
outside the initial scope.
