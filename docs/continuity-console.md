# Continuity control console

The Continuity control console is a local graphical interface for one selected
persona. It reuses `ContinuityControlService`, so the same explicit-action,
persona-isolation, provenance, lifecycle, and protection rules apply to browser
actions.

## Start the console

```powershell
npm run continuity -- --persona PERSONA_ID --database .\data\memtextual.db --migrations .\migrations
```

The command prints a launch URL. Open that exact URL in a local browser and keep
it private. The URL contains a fresh bearer token in its fragment. Fragments are
not sent in HTTP requests, and the page removes the fragment after reading the
token into page memory. Stopping the process invalidates the session.

An optional `--port PORT` selects a port. The default asks the operating system
for an available port.

### Explicit conversation runtime

The browser page always provides a read-only local conversation journal. A
Windows installation can additionally enable graphical live-conversation and
recovery controls by supplying one secret-free configuration file:

```json
{
  "formatVersion": 1,
  "adapterId": "codex-app-server-windows",
  "deploymentConfigurationPath": "C:\\ProgramData\\MemTextual Continuity\\deployment.json",
  "extractionModel": "EXPLICIT_CODEX_MODEL_ID",
  "workingDirectory": "C:\\Users\\YOUR_NAME\\Documents\\MemTextual Conversations"
}
```

`deploymentConfigurationPath` reuses the database, migrations, host-state,
application, and executor paths already selected by the Windows deployment.
`extractionModel` selects only the model used to produce structured memory
candidates; a conversation start may separately choose a conversation model or
use the Codex host default. The working directory is the dedicated directory
assigned to the Codex conversation host.

Do not put an API key, password, token, connection string, certificate, or other
secret in this file. Unknown properties are rejected. Both configuration files,
the deployed database, the working directory, and the host executor must be
direct local files or directories rather than symbolic links where applicable.

Start the configured runtime with:

```powershell
memtextual-continuity --persona PERSONA_ID --conversation-config "C:\ProgramData\MemTextual Continuity\conversation.json"
```

The deployment database and bundled migrations directory are selected
automatically. If `--database` or `--migrations` is also provided, it must
resolve to that same deployment path or startup fails. Omitting
`--conversation-config` preserves the read-only runtime behavior. On shutdown,
the listener stops first, followed by the Codex host and then SQLite.

## Current controls

- Create, revise, enable, or disable the selected persona's conversational
  behavior. Every save creates an immutable revision and affects new
  conversations only; behavior is configuration rather than memory.
- Create a persona memory directly from an explicit user entry. The user must
  choose its episodic or durable class, memory type, sensitivity, retrieval
  policy, and optional pinned or protected state. Direct entries have no source
  evidence attached and are recorded as explicit user-created memories.
- Inspect the selected persona's pending candidates and their retained evidence.
- Inspect exact or semantic match suggestions for a candidate.
- Accept, reject, or ignore a candidate, with an optional review note.
- Reconcile a candidate with a selected active persona memory by revising,
  reaffirming, contradicting, or superseding it.
- Inspect persona memories and immutable revision history.
- List the selected persona's persisted conversations and inspect the exact
  user and assistant text held in MemTextual's durable local capture journal.
  Each conversation shows its journaled-turn count and any pending or failed
  captures that require recovery.
- After provider-confirmed host-thread deletion, preview and permanently purge
  the conversation's owned active-database journal, sources, host-event
  receipts, and candidate lineage when no retained memory or trusted policy
  blocks removal. The immutable conversation and purge receipt remain.
- When the conversation runtime is explicitly enabled, create, inspect, and
  revoke persona-bound host authorizations without exposing their protected
  grants; start a conversation; open an existing conversation through host
  history reconciliation; send turns; leave local readiness; and retry failed
  capture without generating another response.
- Correct an active memory by creating a new immutable revision while retaining
  its earlier wording in history.
- Pin or unpin, protect or unprotect, archive, and restore a memory.
- Download a versioned JSON export of every memory profile and complete revision
  history belonging to the selected persona, including deleted memories.
- Recoverably delete a memory with a reason and exact-ID confirmation, then
  restore it to its prior lifecycle state with another exact-ID confirmation.
- Preview and permanently purge a deleted memory with layered irreversible-
  action safeguards and an assertion-free receipt.

The trusted privacy CLI remains available for the same memory operations and
for source-series privacy workflows.

The durable journal is not necessarily a complete mirror of the host: the host
can contain additional completed turns until opening performs history
reconciliation. A new browser or console process treats stored conversations as
closed until the user explicitly opens and reconciles them.

The loopback server now has an optional conversation API boundary for explicit
authorization creation, authorization listing and revocation, conversation
start, reopen, leave, completed-turn submission, and failed-capture retry. It
fixes the user, persona, relationship, host, and allowed event kind on the
server. Strict browser inputs cannot supply those values or a raw host grant.
If capture fails after a model response completes, the API returns the exact
completed turn and a generic recoverable capture record without returning the
internal exception or grant. Retrying reuses that journaled turn and does not
generate another model response.

The packaged console command enables this optional runtime only when the
explicit configuration above is supplied. Without it, the dashboard reports
conversations as disabled and mutation routes return a service-unavailable
response. With it, the page exposes explicit authorization and conversation
controls. Raw grants remain absent from the database, browser requests, browser
state, responses, configuration, and command-line arguments.

If a model response completes but ambient capture fails, the page refreshes the
durable journal so the completed response remains visible, marks the
conversation closed locally, and requires an explicit capture retry followed by
another open-and-reconcile action. Retry does not submit another model turn.

## External host-thread deletion

For a journaled conversation, the console can request a fresh deletion preview
from the enabled host runtime. The preview discloses the current local turn and
unresolved-capture counts and supplies an exact confirmation phrase. The final
action requires that phrase, two retained-copy acknowledgements, and a browser
confirmation before asking the provider to delete its thread.

Successful provider deletion is journaled and disables reopen and send controls.
The exact local conversation journal remains visible. Derived memories, exports,
database snapshots, encrypted replicas, filesystem copies, and provider backup
retention are outside this action and are never reported as erased.

## Local conversation-journal purge

After host deletion succeeds, the console offers a separate fresh purge
preview. It reports exact active-database row counts, dependent-memory and
trusted-policy blockers, and a state-bound confirmation phrase. Purge requires
an operational reason, that exact phrase, acknowledgement that active-database
deletion is permanent, acknowledgement that external copies may remain, and a
final browser confirmation.

The operation removes exact captured dialogue and its owned source, event, and
candidate lineage from the active database in one transaction. It refuses to
silently break retained-memory evidence or trusted-source policy references.
The conversation binding, provider-deletion record, and assertion-free purge
receipt remain visible. Exports, snapshots, encrypted replicas, filesystem
copies, off-device backups, and provider-retained copies are not modified.

## Persona-memory export

The downloaded `memtextual-continuity-persona-memories` format is versioned and
contains the selected persona and relationship context, current memory profiles,
and every immutable revision for those memories. It excludes source records,
candidate lineage, audit events, other personas, and backup metadata. It is a
portable user-memory record, not a complete database backup or a restorable
database image.

The file can contain sensitive personal information. Browser downloads are
outside the active database: later deletion, purge, or backup-retention actions
do not modify a previously downloaded export.

## Recoverable deletion

The console requires a short operational reason and the exact memory ID before
deletion. Deletion removes the memory from retrieval while preserving its
profile, revisions, and a restorable tombstone. Restoration also requires the
exact ID and returns the memory to its lifecycle state from immediately before
deletion. Neither action purges source evidence, exports, snapshots, or backups.

## Permanent purge

Purge is shown only for a deleted memory. Before enabling the final action, the
console fetches a fresh server-side preview showing revision, candidate, and
audit-event counts plus the IDs of source records that will remain. The user
must then provide a short reason, type the exact memory ID, acknowledge that the
active-database removal is permanent, acknowledge that source records and
external copies are not modified, and accept a final browser confirmation.

The server repeats the preview immediately before purging and rejects a memory
that is no longer eligible. A successful purge removes the memory and its linked
candidate content from the active database and returns an assertion-free receipt.
The UI never creates an automatic pre-purge backup because doing so would create
another retained copy during an erasure request. Existing exports, snapshots,
filesystem copies, off-device backups, and retained source records remain
outside the operation and are disclosed rather than silently claimed as erased.

## Security boundary

- The listener binds only to `127.0.0.1`; it is not a remote or public REST API.
- One running console is fixed to one persona and does not accept a persona or
  scope ID from browser requests.
- Persona-behavior reads and writes are resolved against that server-bound
  persona; browser requests cannot select another persona.
- Conversation summaries and journal details are also resolved against the
  server-bound persona; cross-persona IDs return a not-found response.
- When enabled, conversation authorization and lifecycle routes derive identity,
  relationship, host, and event permissions from the server-bound runtime and
  reject extra browser-selected fields.
- Creating and revoking host authorization, starting or opening conversations,
  sending text, retrying capture, and leaving local readiness each require a
  visible user action. The page does not silently create authorization or retry
  failed operations.
- External host-thread deletion additionally requires a fresh preview, exact
  confirmation, retained-copy acknowledgements, and provider confirmation.
- API requests require the per-launch bearer token.
- Mutations also require an exact same-origin browser request.
- Host validation, strict JSON schemas, a 64 KiB body limit, no-store responses,
  no CORS opt-in, and restrictive content-security headers narrow the local web
  attack surface.
- The page uses only bundled assets and inserts stored content as text, not HTML.

Anyone who obtains the launch URL while the console is running can exercise its
current controls for that persona. Do not share it or expose the listener through
a proxy. Remote access requires the separately planned authenticated transport.
