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

## Turn flow

For each turn, the service:

1. resolves the immutable conversation/persona binding and preflights its
   authorization;
2. composes bounded context using the stored persona ID and current user text;
3. verifies that the serialized payload matches its `memory_data` role, persona,
   and exact UTF-8 accounting;
4. resumes the opaque host conversation and submits the context plus the exact
   user text;
5. waits for authoritative successful host completion; and
6. captures the exact user and assistant messages through
   `AuthorizedHostEventCaptureService`.

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

If host generation fails or is interrupted, no completed-turn capture runs. If
the host succeeds but capture fails, the service throws
`ContinuityConversationCaptureError`, which retains the completed response and
context for the caller and does not report capture success. When source import
completed before an extraction failure, the exact source records remain durable
and a provider extraction failure creates no candidates.

## Current boundary

This package provides library orchestration, not the graphical conversational
client. It does not yet provide chat presentation, persona-behavior prompting,
conversation lists or deletion controls, a durable failed-capture retry queue,
or recovery reconciliation against host history. Those client and reliability
layers remain explicit work.

Codex App Server threads are persistent local records outside the MemTextual
database. They contain the submitted user text, memory-context item, and model
output, so MemTextual database deletion or restore does not alter those copies.
The conversational client must disclose that retention and add coordinated
thread deletion controls before this path is presented as a complete privacy
workflow.
