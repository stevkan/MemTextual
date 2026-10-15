# Conversation hosts

MemTextual Continuity uses the provider-neutral `ConversationHost` interface to
keep its future conversational client independent from a particular model host.
The boundary deals only with conversations and completed turns; persona
selection, context composition, ambient extraction, memory policy, and storage
remain MemTextual responsibilities.

## Contract

A conversation host can:

- start a conversation and return an opaque host-assigned identifier;
- resume a known conversation;
- submit one text turn and stream typed lifecycle events;
- return the authoritative completed assistant text; and
- close its local resources.

Only one turn may be active for a conversation at a time. Host conversation and
turn identifiers are opaque. A failed or interrupted turn is rejected and is
not represented as completed dialog.

## Initial Codex App Server adapter

`CodexAppServerConversationHost` is the only concrete implementation in the
initial scope. It starts `codex app-server` as a child process and communicates
over its default newline-delimited JSON stdio transport. It performs the
required `initialize`/`initialized` handshake, then maps:

- conversation creation to `thread/start`;
- conversation resumption to `thread/resume`;
- turn submission to `turn/start`;
- streamed assistant text to `item/agentMessage/delta`; and
- authoritative assistant text and completion to `item/completed` and
  `turn/completed`.

The adapter does not infer completion from accumulated deltas. It accepts final
assistant content only from completed agent-message items and resolves a turn
only after a successful completed-turn notification.

The current adapter does not handle approval or other server-initiated
requests. It returns a method-not-supported error so an unexpected request
fails closed instead of hanging. It also does not expose stderr, add credentials
to command arguments, or persist protocol traffic.

If the child process exits, every in-flight request and turn fails. A later
operation starts and initializes a fresh process; the caller must explicitly
resume its known conversation before continuing it. Closing the adapter is
terminal.

Codex App Server is currently documented by OpenAI as experimental. Its
protocol-specific behavior is isolated in this adapter, and the automated tests
use a fake JSONL process to cover the handshake, thread creation and resumption,
turn submission, streaming, authoritative completion, request and turn errors,
malformed data, concurrency, process failure, and restart.

## Current boundary

This is an infrastructure package, not the Continuity conversational client.
It does not yet provide a chat UI, bind conversations to personas, compose
persona context, or send completed turns into ambient capture. Those are the
next integration layers and must preserve the existing persona, sensitivity,
review-policy, and evidence safeguards.

OpenAI Responses API hosting, bring-your-own-key configuration,
MemTextual-managed inference, other cloud providers, and local models remain
outside the initial scope.
