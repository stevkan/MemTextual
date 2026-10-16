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

At thread creation, the adapter maps optional persona behavior to Codex App
Server's stable `developerInstructions` field. It prefixes the serialized
contract with its authority limits and preserves the user-authored instruction
text exactly. No persona behavior is sent when none was supplied.

Production construction requires an explicit absolute working directory. The
adapter also supplies that directory to `thread/start` so a Continuity
conversation does not silently inherit instructions or context from whichever
project happened to launch it. The eventual installer must create and protect a
dedicated non-project directory for this purpose.

The adapter does not infer completion from accumulated deltas. It accepts final
assistant content only from completed agent-message items and resolves a turn
only after a successful completed-turn notification.

When bounded MemTextual context is supplied, the adapter places it in a
separate text item with an explicit untrusted-memory-data warning and preserves
the current user text as its own item. Continuity turns use a restricted
read-only sandbox with no readable roots and an approval policy that never asks
the user to authorize an action.

The current adapter does not handle approval or other server-initiated
requests. It returns a method-not-supported error so an unexpected request
fails closed instead of hanging. It also does not expose stderr, add credentials
to command arguments, or persist protocol traffic.

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

Codex App Server is currently documented by OpenAI as experimental. Its
protocol-specific behavior is isolated in this adapter, and the automated tests
use a fake JSONL process to cover the handshake, thread creation and resumption,
turn submission, streaming, authoritative completion, request and turn errors,
malformed data, concurrency, process failure, and restart.

## Current boundary

The persona-bound orchestration layer now persists immutable conversation
bindings, composes bounded context, applies explicit start-time persona
behavior, and routes successful turns into authorized ambient capture. It
remains a library rather than the Continuity conversational client: chat
presentation, persisted behavior-profile editing, conversation controls, and
coordinated deletion are not yet implemented. Completed turns are
journaled before extraction, failed capture can be listed and retried, and
missing journal entries can be reconstructed from authoritative host history
without asking the host to generate the response again.

OpenAI Responses API hosting, bring-your-own-key configuration,
MemTextual-managed inference, other cloud providers, and local models remain
outside the initial scope.
