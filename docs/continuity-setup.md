# Continuity setup

The Continuity setup CLI provides the supported first-run path for creating or
selecting a local Continuity user and persona. It does not create memories,
enable ambient capture, or connect an external chat host.

## Inspect current identities

```powershell
npm run continuity-setup -- status -- --database .\data\memtextual.db --migrations .\migrations
```

`status` is read-only. It reports the user, persona, relationship, and scope
identifiers already present in the selected database. It does not create a new
database when the file is absent.

## Create the first persona

Choose a backup directory outside the active database directory, preferably on
a separate physical device:

```powershell
npm run continuity-setup -- setup -- --user-name "Steve" --persona-name "Skylar" --description "Friendly companion" --backup-directory D:\MemTextualBackups --database .\data\memtextual.db --migrations .\migrations
```

Before onboarding changes an existing database, the command creates an online
SQLite backup, checks its integrity, and writes the durable-data manifest and
export. For a new database, it creates the schema and then snapshots that empty
durable state before adding the user or persona.

The identity operation is transactional. A failure while selecting or creating
the persona rolls back a provisional user and its scopes. After the operation,
the command checks database integrity and foreign keys before committing.

The command is idempotent for the same user and persona names. It reuses the
existing records and reports both `created` values as `false`. It never silently
creates a second user when another user already exists. Use `status`, then pass
`--user-id` when selection is ambiguous:

```powershell
npm run continuity-setup -- setup -- --user-id USER_ID --persona-name "Advisor" --backup-directory D:\MemTextualBackups --database .\data\memtextual.db --migrations .\migrations
```

An existing persona can be selected explicitly with `--persona-id`. Supplying a
different name, description, or relationship name fails rather than overwriting
stored identity data.

On success, the CLI prints the verified snapshot path, selected identifiers,
and the exact `npm run continuity` command for launching the persona-bound local
console.

## Boundary

Setup does not make Continuity observe ChatGPT or another host. Host capture
still requires a separately authorized concrete integration. Setup also does
not infer or save initial memories; memory creation remains an explicit or
review-gated operation.
