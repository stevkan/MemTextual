# Continuity conversation orchestration

`ContinuityConversationService` joins the existing persona, retrieval,
conversation-host, authorization, and ambient-capture boundaries without moving
their policy decisions into a UI or provider adapter.

## Persona binding

Migration 017 adds `continuity_conversations`. Each immutable row binds one
opaque host conversation ID to one user, persona relationship, host adapter,
and explicit host-capture authorization. Database triggers independently reject
a relationship, persona, owner, authorization, or host mismatch. The service
also requires the selected persona on every resume and turn so another persona
receives a not-found-style failure before retrieval or host use.

Starting, resuming, or using a conversation requires the matching active bearer
grant and the `conversation.turn.completed` event permission. Revocation stops
new turns before context retrieval or model submission. The grant is never
stored in the conversation row.

## Persona behavior

Migration 019 adds optional, append-only persona behavior profiles. Creating or
changing a profile requires an explicit user action and the expected current
revision number. Instructions are preserved exactly, revisions cannot be
updated or deleted, and disabling behavior creates another retained revision.
No profile is created during migration or persona creation, so existing and
unconfigured personas continue to start neutrally.

When a conversation starts, the service resolves the selected persona's current
profile. If it is enabled, the service packages that exact revision in the
versioned `memtextual.persona_behavior` contract. It never derives behavior
from persona descriptions, memories, retrieved context, or conversation text.
The immutable conversation binding records the applied profile ID and revision;
later edits apply only to new conversations.

The Codex App Server adapter supplies the contract through
`developerInstructions` only when starting the thread. Its framing limits the
configuration to conversational identity, style, and interaction preferences;
it does not authorize tools, data access, system changes, or memory-policy
changes. Memory data and the current user message remain separate turn inputs.

The local Continuity control console exposes profile creation, revision,
enablement, disablement, and history for its bound persona. Existing host
threads retain the behavior with which they were created.

## Turn flow

For each turn, the service:

1. resolves the immutable conversation/persona binding and preflights its
   authorization;
2. composes bounded context using the stored persona ID and current user text;
3. verifies that the serialized payload matches its `memory_data` role, persona,
   and exact UTF-8 accounting;
4. resumes the opaque host conversation and submits the context plus the exact
   user text;
5. waits for authoritative successful host completion;
6. writes the exact completed turn to the durable capture journal; and
7. captures the exact user and assistant messages through
   `AuthorizedHostEventCaptureService`, then links its immutable receipt to the
   journal entry.

The Codex adapter sends memory JSON as a separate text item with an explicit
untrusted-data warning. It does not rewrite the user's text. The adapter also
sets a restricted read-only sandbox with no readable roots and never requests
approvals. Unexpected server-initiated requests remain unsupported and fail
closed.

`ContinuityConversationTurnAdapter` creates a chat source with separate `user`
and `assistant` records. Context revision identifiers are metadata; retrieved
memory assertions are not copied into the source or made extraction evidence.
Candidate extraction, sensitivity classification, temporal handling, and review
automation then follow the existing ambient-memory rules. A successfully
completed turn does not imply that every proposal is automatically accepted.

If host generation fails or is interrupted, no completed-turn capture runs.
Migration 018 adds `continuity_conversation_turn_captures`, an immutable-payload
journal with visible `pending`, `failed`, and `captured` states. Each entry
stores the exact completed dialogue, original completion time, context format,
and revision identifiers. It never stores the bearer grant or raw exception
text. Failed attempts retain only the generic `ambient_capture_failed` code.

If the host succeeds but capture fails, the service throws
`ContinuityConversationCaptureError`, which retains the completed response,
context, and durable journal entry without reporting capture success.
`listRecoverableCaptures` exposes pending and failed entries only within the
selected persona. `retryCapture` rechecks the original authorization and reuses
the original event identity and dialogue; it does not submit another model
turn. Deterministic source and event identities make retries idempotent. When
source import completed before an extraction failure, the exact source records
remain durable and a provider extraction failure creates no candidates.

The journal duplicates exact dialogue inside the MemTextual database and is
therefore included in database snapshots and encrypted replication. Deletion
and retention controls must account for both this journal and the separately
stored host thread.

## Host-history reconciliation

`reconcileConversationHistory` closes the process-loss gap between host
completion and journal insertion. It preflights the conversation's active
persona-bound authorization before reading history. The host must return exact
completed turns with recorded completion timestamps and the original
MemTextual context identifiers.

The service validates the entire returned history before writing anything. It
rejects duplicate turn IDs, cross-conversation or cross-persona content,
invalid context metadata, and any disagreement between an existing journal
entry and host history. Missing turns are journaled oldest first and passed
through the same authorized ambient-capture path. Existing turns are not
recaptured. A later reconciliation is idempotent and never starts a model turn.
If extraction fails, the new journal entry becomes `failed`, the operation
throws `ContinuityConversationReconciliationCaptureError`, and ordinary
`retryCapture` remains available.

## Client lifecycle gate

`ContinuityConversationClientCoordinator` provides the lifecycle a future
client must use. A newly started conversation becomes ready immediately. A
persisted conversation remains closed until the coordinator has reconciled its
authoritative host history, checked for pending or failed capture records for
that exact conversation, and resumed the host session in that order.

Unresolved records produce
`ContinuityConversationOpenRecoveryRequiredError`, including the exact
persona-authorized records the client must present for recovery. Reconciliation
or resume failure leaves the conversation closed. Only one turn can be active
per conversation, and any turn failure closes local readiness so the next turn
requires an explicit reopen and reconciliation. Leaving a conversation also
removes readiness. This state is process-local and stores no bearer grant.

## Read-only catalog

`ContinuityConversationCatalogService` lists persisted conversation summaries
for one validated persona and returns persona-bound detail from the durable
capture journal. Summaries include the journaled-turn count, the pending or
failed capture count, and the most recent locally known activity time. Detail
preserves the exact journaled user and assistant text in chronological order.

The local Continuity control console presents this catalog and unresolved
recovery state without contacting the host. It describes the result as a local
journal rather than complete host history because reconciliation can still
discover additional turns.

## Current boundary

This package provides library orchestration plus a read-only graphical
conversation catalog; it is not yet the graphical conversational client. The
console does not start, reopen, or send turns. Those actions require a protected
grant store that can restore the raw host bearer after process restart without
putting it in SQLite, browser state, or command-line arguments. Coordinated
host-thread deletion controls also remain open.

Codex App Server threads are persistent local records outside the MemTextual
database. They contain the submitted user text, memory-context item, and model
output, so MemTextual database deletion or restore does not alter those copies.
The conversational client must disclose that retention and add coordinated
thread deletion controls before this path is presented as a complete privacy
workflow.
