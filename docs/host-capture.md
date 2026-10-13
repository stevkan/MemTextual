# Authorized host-event capture

`AuthorizedHostEventCaptureService` is the library boundary through which a
chat client, persona host, or other application may deliver an event to
Continuity. It does not listen to applications itself and it is not exposed
through the current MCP server.

## Authorization

`HostAuthorizationService.authorize` requires an explicit user action and binds
one authorization to one user, persona relationship, host adapter ID, and
non-empty event-kind allowlist. An optional UTC-normalized expiration can
further narrow the grant. The returned bearer grant is shown once; SQLite
stores only its SHA-256 hash. Revocation also requires an explicit user action
and is irreversible for that authorization.

A capture is rejected before its adapter runs unless the grant, active status,
host ID, persona, relationship, event kind, and expiration all match. The
database independently enforces the authorization and persona relationships
when a successful event receipt is written.

## Adapter and extraction flow

A versioned `HostEventAdapter` converts a host-owned event payload into an
`ImportSourceInput`. MemTextual replaces any adapter-supplied external source
identity with a deterministic identity derived from the authorization and host
event ID. It also records the adapter ID/version and event identity in source
metadata. The resulting source then passes through `AmbientMemoryService` and
the same evidence, sensitivity, temporal, persona, and review boundaries as
other ambient capture.

Host adapters and extraction providers may be asynchronous. Concrete vendor
SDKs, network clients, event subscriptions, credentials, and payload schemas
remain deployment integrations rather than MemTextual core dependencies.

## Replay and receipts

Each successful event creates an immutable `continuity_host_events` receipt
with its authorization, host adapter version, persona relationship, source,
candidate IDs, and a canonical SHA-256 payload-and-mapping hash. Replaying the
same event and normalized adapter output reuses the receipt and creates no new
candidates. Reusing an event ID with changed input or adapter output is
rejected.

Only successful captures have host-event receipts. Source import precedes
provider extraction so provider failures can leave retained source evidence,
but cannot create partially validated candidates. A retry uses the same
deterministic source identity. Database constraints reject receipts whose
candidates do not belong to that source and persona.

The grant is a bearer secret. A host must keep it out of logs and source
metadata, restrict it to the authorized process, and replace it by creating a
new authorization after revocation or suspected exposure.
