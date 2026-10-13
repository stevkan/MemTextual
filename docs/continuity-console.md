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

## Current controls

- Inspect the selected persona's pending candidates and their retained evidence.
- Inspect exact or semantic match suggestions for a candidate.
- Accept, reject, or ignore a candidate, with an optional review note.
- Reconcile a candidate with a selected active persona memory by revising,
  reaffirming, contradicting, or superseding it.
- Inspect persona memories and immutable revision history.
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
- API requests require the per-launch bearer token.
- Mutations also require an exact same-origin browser request.
- Host validation, strict JSON schemas, a 64 KiB body limit, no-store responses,
  no CORS opt-in, and restrictive content-security headers narrow the local web
  attack surface.
- The page uses only bundled assets and inserts stored content as text, not HTML.

Anyone who obtains the launch URL while the console is running can exercise its
current controls for that persona. Do not share it or expose the listener through
a proxy. Remote access requires the separately planned authenticated transport.
