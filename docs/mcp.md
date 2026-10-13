# Local MCP server

## Purpose

MemTextual exposes `MemoryService` through a local Model Context Protocol server
using stdio. The transport contains no lifecycle or retrieval business rules;
it validates tool inputs and delegates to the service.

The implementation uses the official MCP TypeScript SDK v2 packages:

- `@modelcontextprotocol/server` for the server and stdio transport;
- `@modelcontextprotocol/client` for integration tests; and
- Zod 4 for tool input schemas.

## Run from source

```powershell
npm run mcp -- --database .\data\memtextual.db --migrations .\migrations
```

The server writes only MCP protocol messages to stdout. Startup and error
messages use stderr.

## Configuration

Command-line options take precedence over environment variables.

| Setting | Command line | Environment | Default |
| --- | --- | --- | --- |
| Database | `--database PATH` | `MEMTEXTUAL_DB_PATH` | `./memtextual.db` |
| Migrations | `--migrations PATH` | `MEMTEXTUAL_MIGRATIONS_DIR` | `./migrations` |

Relative paths resolve from the server process's working directory. For MCP host
configuration, absolute paths are recommended.

## Tools

| Tool | Behavior |
| --- | --- |
| `scope_list` | Lists configured scopes. |
| `scope_create` | Creates a global, project, conversation, or namespace scope. |
| `memory_create` | Creates a memory and its first immutable revision. |
| `memory_get` | Gets current memory state by ID. |
| `memory_history` | Lists immutable revisions in chronological order. |
| `memory_retrieve` | Performs policy-aware FTS retrieval in authorized scopes. |
| `memory_revise` | Revises an unprotected active memory. |
| `memory_archive` | Archives an unprotected active memory. |
| `memory_restore` | Restores an unprotected archived memory. |
| `memory_supersede` | Relates a replacement and supersedes the old memory. |
| `memory_contradict` | Relates a contradicting memory and marks the old one contradicted. |
| `source_import` | Imports an immutable source; changed external content requires `createVersion: true`. |
| `source_history` | Lists all versions for a source kind and external ID. |
| `source_list` | Lists current sources. |
| `source_records` | Lists the ordered records retained for one source version. |
| `source_record_get` | Gets one source record by ID. |
| `candidate_propose` | Proposes a reviewable memory candidate from source evidence. |
| `candidate_get` | Gets one candidate and its review state. |
| `candidate_list` | Lists candidates, optionally filtered by review state. |
| `server_info` | Reports server identity, capabilities, and the complete tool catalog. |

Read tools advertise read-only annotations. Lifecycle removals advertise
destructive annotations. All tools advertise a closed-world hint because this
server uses only the local database.

## Protected memories

MCP calls use the `system` actor. They cannot assert that a user explicitly
authorized a protected-memory mutation, so protected memories cannot be revised,
archived, restored, superseded, or contradicted through this transport.

Explicit protected-memory management remains available to a future local admin
interface that can obtain direct user confirmation.

Memory and source-series deletion, restoration, and purge are also absent from
MCP. They always require an explicitly confirming user and are available
through the trusted local `memtextual-privacy` CLI described in `privacy.md`.

Continuity persona creation and persona-aware retrieval are currently
library-only. The generic MCP retrieval tool still requires caller-authorized
scope IDs and must not be presented as the Continuity persona boundary.

## Example host configuration

Build the project, then configure an MCP host to launch the compiled entry point.
Use the actual Node executable path if the host does not inherit an NVS-enabled
PowerShell environment.

```json
{
  "mcpServers": {
    "memtextual": {
      "command": "C:\\path\\to\\node.exe",
      "args": [
        "C:\\path\\to\\MemTextual\\dist\\src\\mcp\\stdio.js",
        "--database",
        "C:\\path\\to\\MemTextual\\data\\memtextual.db",
        "--migrations",
        "C:\\path\\to\\MemTextual\\migrations"
      ]
    }
  }
}
```

The exact configuration location and field names depend on the MCP host.

## Verification

Automated tests use the SDK's linked in-memory transport for tool discovery and
calls. A separate integration test launches the real stdio entry point as a
child process and completes an MCP handshake.

## Server discoverability

The read-only `server_info` tool lets users inspect
MemTextual's exposed capabilities even when an MCP host does not display its
discovered tool list.

The tool requires no arguments and returns:

- the stable server name and current server version;
- the complete twenty-tool catalog, including each tool's name, description,
  and safety annotations; and
- capability metadata distinguishing implemented features from planned
  features.

The response does not expose credentials, database contents, or local database
and migration paths. Calling `server_info` does not mutate application state or
write an audit event.

## Current limitations

- MCP resources and prompts;
- Streamable HTTP transport and authentication;
- host-specific installers and configuration writers;
- explicit-user confirmation for protected-memory mutation;
- scope hierarchy expansion during retrieval; and
- semantic or hybrid vector search.
