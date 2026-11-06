# Continuity setup

The Continuity setup CLI provides the supported first-run path for creating or
selecting a local Continuity user and persona. It does not create memories or
enable ambient capture. Guided setup contacts Codex App Server only to read its
model catalog; it does not start a conversation or run inference.

## Automated Windows setup

The unified CLI stores routine paths in a strict, secret-free installation
profile and generates both deployment configuration files. The recommended
source-based first run is guided setup:

```powershell
npm run memtextual -- setup -- --interactive
```

It reads the current Codex App Server catalog, displays the model names and
identifiers, and requires a numbered selection. It marks the Codex default but
does not select it automatically. The catalog is not an access guarantee; the
first successful inference verifies access to the selected model.
[OpenAI's Codex App Server documentation](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
defines this catalog boundary.

For automated setup, list the catalog first and assign one returned `model`
value explicitly:

```powershell
npm run memtextual -- models
$extractionModel = Read-Host "Enter one model value shown above"
npm run memtextual -- setup -- --user-name "Steve" --persona-name "Skylar" --extraction-model "$extractionModel"
```

If the package binary has been placed on `PATH`, the equivalent is:

```powershell
memtextual models
$extractionModel = Read-Host "Enter one model value shown above"
memtextual setup --user-name "Steve" --persona-name "Skylar" --extraction-model "$extractionModel"
```

The Continuity MSI installs a `Set up MemTextual Continuity` Start-menu
entry that runs this same interactive workflow with the bundled Node runtime.
The prompts collect personal configuration only after Windows Installer has
finished, keeping those values out of MSI properties and logs. Required answers
have no inferred defaults; the suggested backup directory is the managed local
backup path and can be replaced with another absolute path.

A staged directory bundle can invoke the same launcher without relying on
`PATH`:

```powershell
& "$application\runtime\node.exe" "$application\dist\src\cli\memtextual.js" models
$extractionModel = Read-Host "Enter one model value shown above"
& "$application\runtime\node.exe" "$application\dist\src\cli\memtextual.js" setup --user-name "Steve" --persona-name "Skylar" --extraction-model "$extractionModel"
```

`MODEL_ID`, `MODEL_ID_FROM_LIST`, and `EXPLICIT_CODEX_MODEL_ID` are explanatory
placeholders, not valid configuration values; setup rejects them explicitly.

Unless explicitly overridden, setup uses
`C:\ProgramData\MemTextual Continuity` and creates stable `data`, `backups`,
`host-state`, and `conversations` directories. It writes `deployment.json`,
`conversation.json`, and `installation.json`, creates the database, takes the
onboarding snapshot, and remembers the selected user and persona. Use
`--backup-directory` to put recovery points on a separate device; the local
default improves convenience but is not protection from system-drive failure.

After setup, routine commands no longer require database or configuration
paths:

```powershell
memtextual status
memtextual host-install-preview
memtextual start
```

Host apply and removal remain explicit, confirmation-bound elevated operations.
An existing managed configuration is reused only when its paths, model, user,
and persona match; setup refuses to overwrite conflicting settings.

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
