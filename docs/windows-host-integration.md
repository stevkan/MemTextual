# Windows host integration

MemTextual's Windows host layer separates unprivileged planning from elevated
operating-system changes. The TypeScript orchestration previews the exact
identity, ACL paths, and scheduled-task definitions, binds them to a fresh
confirmation, and then calls the PowerShell executor through a narrow JSON
protocol.

## Security model

The executor is `scripts/windows-host-executor.ps1`. Its mutation actions must
run from an elevated administrator process. Requests are read from standard
input, successful responses are JSON on standard output, and diagnostic errors
go to standard error. The command line carries only the action and non-secret
state-directory path.

The executor:

- creates a dedicated local account marked as managed by MemTextual;
- generates that account's random password inside the elevated process;
- protects the password with machine-scoped Windows DPAPI and restricts its
  file to Local System and local Administrators;
- accepts scheduled environment values only through the standard-input JSON
  request, protects them with DPAPI, and grants the service account read access
  only to the required protected values;
- applies non-inheriting ACLs that retain Local System and Administrators while
  granting the service identity either read or modify access as explicitly
  configured;
- registers tasks under `\MemTextual\` with password logon, limited run level,
  missed-start recovery, single-instance behavior, and a two-hour execution
  limit; and
- stores a hashed ownership marker plus a protected manifest so inspection and
  removal fail closed if a task was changed or is not owned by MemTextual.

Password logon is intentional. Windows S4U tasks do not retain a password, but
they also cannot access the network or encrypted files, which makes them
unsuitable for Azure replication.

## Safeguards

Install and removal remain explicit preview-and-apply operations. Existing
local accounts or tasks without verified MemTextual ownership are never
adopted, overwritten, or removed. A failed installation removes tasks and the
identity created by that attempt. Removal unregisters only verified managed
tasks and deletes only their DPAPI task-secret copies plus the generated
account-password record. It preserves the SQLite database, backups, Azure
certificate, destination configuration, recovery packages, and every path in
the installation plan.

The current package provides the executor and programmatic bridge. It does not
yet expose an elevated end-user installer command, copy application files into
their final installation directory, or choose database, backup, retention, or
schedule settings. Those remain explicit installer inputs in the next package.

## Runtime compatibility

The bridge invokes 64-bit Windows PowerShell 5.1 with profiles disabled and a
bounded execution timeout. PowerShell receives at most 1 MiB of JSON and may
return at most 1 MiB on either output stream. The executor uses only Windows
local-account, ACL, DPAPI, and Scheduled Tasks facilities. macOS and Linux
packages will require separate host executors behind the same TypeScript
contracts.
