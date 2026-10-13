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

The console does not yet expose export, recoverable deletion, or confirmed
purge. Those operations remain available through their existing trusted library
or CLI boundaries where implemented.

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
