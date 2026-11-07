# Windows host integration

MemTextual's Windows host layer separates unprivileged planning from elevated
operating-system changes. The TypeScript orchestration previews the exact
identity, ACL paths, and scheduled-task definitions, binds them to a fresh
confirmation, and then calls the PowerShell executor through a narrow JSON
protocol.

## Security model

The executor is `scripts/windows-host-executor.ps1`. Its identity, scheduled-
task, and protected-path mutation actions must run from an elevated
administrator process. Conversation-grant actions run as the identity that owns
the grant and do not require elevation. Requests are read from standard input,
successful responses are JSON on standard output, and diagnostic errors go to
standard error. The command line carries only the action and non-secret state-
directory path.

The executor:

- creates a dedicated local account marked as managed by MemTextual;
- generates that account's random password inside the elevated process;
- grants the managed account the Windows batch-logon right required by Task
  Scheduler and revokes that right before removing the account;
- protects the password with machine-scoped Windows DPAPI and restricts its
  file to Local System and local Administrators;
- accepts scheduled environment values only through the standard-input JSON
  request, protects them with DPAPI, and grants the service account read access
  only to the required protected values;
- accepts conversation bearer grants only through the same bounded protocol,
  protects them with current-user DPAPI, and creates non-replacing files with
  restrictive ACLs and complete authorization-binding validation;
- applies either additive service-account ACL grants for ordinary application,
  database, backup, and configuration paths or restrictive non-inheriting ACLs
  for explicitly sensitive paths such as the certificate private key;
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
identity created by that attempt. Original ACLs are retained in a restricted
  ownership manifest and restored during rollback when that attempt created the
  protection boundary. Restoration is verified before the manifest is removed:
  owner, group, access entries and order, and relevant control flags must match.
  Windows' documented `DACL_AUTO_INHERITED` normalization is the sole allowed
  descriptor difference after an inheriting DACL has been rewritten. Removal
  restores those ACLs, unregisters only verified
managed tasks, and deletes only their DPAPI task-secret copies plus the
generated account-password record. It preserves the SQLite database, backups,
Azure certificate, destination configuration, recovery packages, and every
path in the installation plan.

The user-facing deployment contract and elevated installer CLI are documented
in [windows-continuity-deployment.md](windows-continuity-deployment.md). They
bind explicit database, backup, schedule, destination, and credential-reference
inputs to the host orchestration. Application-file creation, verification, and
staging are handled separately by the signed-manifest directory-bundle workflow
documented in [windows-continuity-bundle.md](windows-continuity-bundle.md).

Elevated release validation is separately opt-in. A synthetic-workspace-bound
preview issues one exact confirmation for installing the dedicated validation
identity and backup schedule, verifying host acceptance, executing the managed
task, and removing only the resources created by that run. It refuses
pre-existing resources and records incomplete cleanup instead of claiming
success. See
[windows-release-validation.md](windows-release-validation.md).

## Runtime compatibility

The bridge invokes 64-bit Windows PowerShell 5.1 with profiles disabled and a
bounded execution timeout. PowerShell receives at most 1 MiB of JSON and may
return at most 1 MiB on either output stream. The executor uses only Windows
local-account, ACL, DPAPI, and Scheduled Tasks facilities. File hashing, ACL,
and secure-string operations use the underlying .NET APIs and do not depend on
loading the general PowerShell utility or security modules or reading
audit-policy ACL sections. macOS and Linux packages will require separate host
executors behind the same TypeScript contracts.
