# MemTextual Developer setup

MemTextual Developer uses a saved per-user installation profile so routine
commands do not require repeated database, migration, executable, or backup
paths.

## Requirements

- Windows;
- Node.js 24.21.0;
- a completed production build (run npm run build when using source); and
- Codex CLI when connecting the MCP server to Codex.

## Automated setup

From the repository after building:

~~~powershell
npm run memtextual -- developer setup
~~~

From an installed package:

~~~powershell
memtextual developer setup
~~~

Setup creates these defaults:

~~~text
%LOCALAPPDATA%\MemTextual Developer\
  installation.json
  data\memtextual.db
  backups\
~~~

The saved profile also records the built MCP server, migrations directory,
Node executable, and Codex server name. Existing settings are reused only when
they match exactly; setup refuses to overwrite a different profile.

Before migrating an existing database, setup creates a verified snapshot. For a
new database, it applies all migrations, verifies SQLite integrity and foreign
keys, creates a verified baseline snapshot, and only then writes the profile.
Repeating setup verifies the saved database and returns without recreating it.

The default backup directory is convenient but is on the same system drive.
Use --backup-directory D:\MemTextualBackups during the first setup when a
separate protected drive is available.

## Verify the saved setup

~~~powershell
memtextual developer status
~~~

When running from source, use:

~~~powershell
npm run memtextual -- developer status
~~~

Routine status and connection commands read the remembered profile. Use
--data-root PATH only when managing a non-default profile.

## Connect to Codex

First request a read-only preview:

~~~powershell
memtextual developer connect-preview
~~~

If no Codex MCP server uses the saved name, the preview returns an add action
and a confirmation token. Apply that exact fresh token:

~~~powershell
memtextual developer connect-apply --confirm "CONNECT-CODEX-MCP-..."
~~~

The apply command rechecks current Codex configuration before changing it and
verifies the exact registration afterward. If the server name already has a
different registration, MemTextual reports blocked-existing and does not
replace or remove it. Resolve that conflict explicitly, then request a new
preview and token.

Start a new Codex task after a successful connection. In that task, call the
read-only server_info or scope_list tool to verify discovery and transport.

## Overrides

First-time setup accepts these optional overrides:

- --data-root PATH
- --database PATH
- --backup-directory PATH
- --application-directory PATH
- --node PATH
- --server-name NAME

The connection commands first use `codex` from the executable search path. On
Windows, if that command is unavailable, MemTextual also discovers a single
Codex desktop CLI under `%LOCALAPPDATA%\OpenAI\Codex\bin`. It refuses to choose
silently when multiple desktop CLI installations are present.

The connection commands accept `--codex-command PATH` for an explicit choice.
When running from source through npm 11, use an additional argument separator
so npm forwards that named option instead of consuming it:

~~~powershell
npm run memtextual -- developer connect-preview -- --codex-command "C:\full\path\to\codex.exe"
~~~

An installed `memtextual` command does not need the additional separator:

~~~powershell
memtextual developer connect-preview --codex-command "C:\full\path\to\codex.exe"
~~~

Automatic discovery means `Get-Command codex` is not a required setup step.
Setup overrides are stored as absolute paths where applicable; they do not need
to be entered again.

## Manual configuration

The manual MCP launch and host-configuration format remains documented in
[mcp.md](mcp.md) for unsupported MCP hosts and development diagnostics. The
automated connection workflow currently targets Codex only.
