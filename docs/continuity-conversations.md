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

## External host-thread deletion

Migration 020 adds a durable host-deletion journal with `pending`, `failed`,
and provider-confirmed `deleted` states. A deletion attempt is recorded before
the external request, retains only a generic failure code, and cannot be erased.
The provider-neutral deletion capability returns a receipt only after the host
accepts its delete request. The Codex adapter maps this operation to
`thread/delete` and accepts only the protocol's empty success result.

The console first returns a fresh, persona-bound preview. Its exact confirmation
changes if the local turn or recovery counts change. Deletion then requires a
visible user action, that exact confirmation, acknowledgement that the local
journal and derived memories remain, and acknowledgement that snapshots and
backups may retain copies. An active process-local conversation is closed before
the attempt. A provider-confirmed thread cannot be reopened or sent new turns,
but its local journal remains available and failed capture can still be retried.

This is deliberately not a complete-erasure operation. It does not delete the
MemTextual journal, candidates, memories, exports, snapshots, backups, or other
provider-controlled retained copies. Automatic retention schedules are not
installed or inferred.

## Local conversation-journal purge

Migration 021 adds an optional second privacy operation after provider-confirmed
host deletion. A persona-bound preview identifies every matching active-database
turn capture, host-event receipt, chat source series, source record, and memory
candidate. Its exact confirmation is bound to a fingerprint of that impact.

Purge is blocked when the host deletion is not confirmed, a retained memory
still depends on the captured evidence, an active review policy trusts one of
the source identities, a captured turn has incomplete source provenance, or a
purge receipt already exists. The repository rechecks the fingerprint and all
blockers inside the deletion transaction.

After a visible user action, exact confirmation, operational reason, and two
retained-copy acknowledgements, one transaction writes an immutable receipt and
removes the owned dialogue copies and their candidate lineage from the active
database. The immutable conversation binding and host-deletion journal remain,
so the catalog can show what action occurred without retaining the dialogue.
Retained memories are never silently detached from evidence.

This operation does not modify exported files, SQLite snapshots, encrypted or
off-device backups, filesystem copies, or copies retained by the provider. The
console states that boundary before confirmation and never describes the action
as complete erasure.

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

`ContinuityConversationProtectedClient` is the outer runtime boundary for
start, reopen, send, and leave. It accepts persona and conversation identifiers,
not raw grants. It resolves canonical bindings through the protected
authorization service, loads the bearer only inside the process, delegates to
the coordinator, and verifies that returned conversations have not crossed an
authorization or stored-conversation binding.

## Read-only catalog

`ContinuityConversationCatalogService` lists persisted conversation summaries
for one validated persona and returns persona-bound detail from the durable
capture journal. Summaries include the journaled-turn count, the pending or
failed capture count, any immutable local-purge receipt, and the most recent
locally known activity time. Before purge, detail preserves the exact journaled
user and assistant text in chronological order; afterward, the turn list is
empty while the binding and receipt remain.

The local Continuity control console presents this catalog and unresolved
recovery state without contacting the host. It describes the result as a local
journal rather than complete host history because reconciliation can still
discover additional turns.

## Current boundary

The trusted server-side runtime composition is implemented. It wires the Codex
conversation host and structured ambient extractor to lexical memory context,
authorized turn capture, the durable conversation journal, protected grant
resolution, persona behavior, and the grantless client facade. The Windows
composition uses the DPAPI grant store through an injected PowerShell bridge.
The runtime owns and closes its host, but never closes the caller-owned database.
No embedding provider is required, and absent sensitivity classification still
fails closed to sensitive, pending candidates.

The local console server exposes optional, same-origin, token-protected
authorization and conversation operations without accepting or returning host
bearer grants. It fixes persona and host authority server-side and preserves a
completed model response in a structured recovery response if ambient capture
fails. A grantless retry operation can recapture that exact journaled turn
without another model response. The packaged Windows CLI constructs this
runtime only when given an explicit, secret-free conversation configuration
that references the existing deployment configuration. It verifies that the
deployment database is the database opened by the console and closes the
listener, host, and database in dependency order. The graphical page exposes
explicit grantless authorization, start, open-and-reconcile, send, leave, and
capture-retry controls while continuing to render the exact durable journal.
Completed output remains visible when capture fails, and the page requires
recovery before reopening rather than silently retrying or regenerating a turn.
The same page exposes preview-bound external host-thread deletion and the
separate preview-bound local journal purge, each with explicit retained-copy
acknowledgements and durable status.

Codex App Server threads are persistent local records outside the MemTextual
database. They contain the submitted user text, memory-context item, and model
output, so MemTextual database deletion or restore does not alter those copies.
The coordinated control can delete the host thread. Only after that deletion is
provider-confirmed can a separate action purge the active MemTextual journal;
neither action alters retained backup copies or is presented as a complete
privacy-erasure workflow.
