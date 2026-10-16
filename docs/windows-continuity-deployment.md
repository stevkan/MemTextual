# Windows Continuity deployment

MemTextual Continuity has a preview-first Windows host installer CLI. It
configures unattended local backups and, when explicitly included, encrypted
off-device replication under one dedicated local account.

The host CLI does not download or copy application files, create Azure
resources, choose storage locations, or generate the separately retained
recovery key. Those inputs must exist before host installation. The separate
[signed-bundle workflow](windows-continuity-bundle.md) can assemble, verify, and
stage application files without selecting the user's data or service settings.

The selected [MSI workflow](windows-msi.md) can invoke this same host boundary
only when installation explicitly sets `MEMTEXTUAL_HOST_ACTIONS=1`. Its deferred
install, uninstall, and paired rollback actions use the fixed deployment path
`C:\ProgramData\MemTextual Continuity\deployment.json`. MSI omission of that
property remains application-files-only installation.

## Deployment layout

`applicationDirectory` is immutable application content readable by the
service identity:

```text
APPLICATION_DIRECTORY\
  runtime\node.exe
  dist\src\cli\safeguard.js
  scripts\windows-host-executor.ps1
  node_modules\...
```

The exact compiled dependency tree required by `safeguard.js` must be present.
The installer validates the three named entry points but does not attempt to
infer whether an incomplete dependency tree was staged.

Application, database, backup, destination, and non-secret configuration paths
receive additive access for the dedicated account; their existing user access
is not removed. The Azure certificate PEM is explicitly restrictive because it
contains a private key. Every changed ACL is still recorded for exact removal.

Mutable content is separate:

```text
PROGRAM_DATA_ROOT\
  data\memtextual.db
  host-state\                 # created by the privileged executor if absent
  destination.json            # optional, secret-free
  credential.json             # Azure only, secret-free
  credentials\azure.pem       # Azure only, certificate plus private key

USER_SELECTED_BACKUP_DIRECTORY\
USER_SELECTED_LOCAL_OFFSITE_DIRECTORY\  # local-directory adapter only
```

The database and backup directories must already exist. The active database
must also exist before host installation. The backup and offsite destinations
remain explicit user decisions because MemTextual cannot reliably determine
whether two paths are on separate physical devices.

## Strict deployment file

The deployment file contains paths, intervals, identifiers, and environment-
variable names only. Unknown properties are rejected. It must not contain the
recovery key, an Azure account key, a connection string, SAS token, password,
client secret, or other credential value.

Local-backup-only example:

```json
{
  "formatVersion": 1,
  "applicationDirectory": "C:\\Program Files\\MemTextual Continuity",
  "databasePath": "C:\\ProgramData\\MemTextual Continuity\\data\\memtextual.db",
  "backupDirectory": "D:\\MemTextual Backups",
  "stateDirectory": "C:\\ProgramData\\MemTextual Continuity\\host-state",
  "identityName": "MemTextualSvc",
  "backupIntervalHours": 24,
  "backupPollIntervalMinutes": 60
}
```

Optional offsite section:

```json
{
  "offsite": {
    "destinationConfigurationPath": "C:\\ProgramData\\MemTextual Continuity\\destination.json",
    "credentialConfigurationPath": "C:\\ProgramData\\MemTextual Continuity\\credential.json",
    "intervalHours": 24,
    "pollIntervalMinutes": 60,
    "keyEnvironmentVariable": "MEMTEXTUAL_OFFSITE_KEY",
    "keyId": "recovery-key-2026"
  }
}
```

`credentialConfigurationPath` is required for `azure-blob` and forbidden for
`local-directory`. The destination and Azure credential files use the strict
formats in [replication-destinations.md](replication-destinations.md). For an
Azure deployment, their credential IDs must match.

Backup intervals may be from five minutes through 24 hours. Offsite intervals
may be from five minutes through 8,760 hours. Poll intervals are whole minutes
from 5 through 1,440. Polling more often than the due interval is safe because
the safeguard commands use their append-only local state to decide whether
work is due.

## Installation

Run preview without elevation if the host permits task inspection:

```powershell
memtextual-windows-host install-preview --config "C:\ProgramData\MemTextual Continuity\deployment.json"
```

Review the returned identity, paths, schedules, and confirmation. For offsite
replication, put the canonical-base64 32-byte recovery key in the deployment's
named environment variable in the elevated process. Then open an elevated
Windows terminal and apply the exact fresh token:

```powershell
memtextual-windows-host install-apply --config "C:\ProgramData\MemTextual Continuity\deployment.json" --confirm "INSTALL-WINDOWS-HOST-..." --actor local-user
```

Apply fails before host mutation if a configured recovery key is absent,
malformed, or not exactly 32 bytes. The key is sent over standard input to the
privileged executor, protected with machine-scoped DPAPI, and omitted from the
task command line and deployment files.

Installation creates only resources listed by the preview. It refuses to adopt
same-named unmanaged accounts or tasks. If installation fails, newly created
tasks and identities are removed. Original filesystem ACLs are stored in a
restricted ownership manifest and restored when the failed attempt created the
protection boundary.

## Removal

Removal is also preview-first:

```powershell
memtextual-windows-host remove-preview --config "C:\ProgramData\MemTextual Continuity\deployment.json"
memtextual-windows-host remove-apply --config "C:\ProgramData\MemTextual Continuity\deployment.json" --confirm "REMOVE-WINDOWS-HOST-..." --actor local-user
```

Removal unregisters only verified MemTextual-owned tasks, restores the original
ACLs recorded during installation, and removes only the verified managed local
account and its DPAPI host records. It preserves the database, local backups,
offsite packages, application files, deployment files, destination
configuration, Azure credential configuration, certificate, and recovery key.

Keep the deployment file unchanged while the host integration is installed.
Changing paths or schedule definitions produces a different confirmation and
will cause ownership checks to fail rather than altering or removing resources
under a different definition.

After onboarding and conversation configuration, run the read-only installation
gate in [continuity-first-use.md](continuity-first-use.md). It verifies the
signed staged application, expected host installation, current database,
migrations, and selected persona before normal use.

Upgrades use a new side-by-side signed application directory and a new
deployment file. Remove the old host integration before installing the new
definitions; retain the old application and verified pre-upgrade snapshot until
acceptance succeeds. The ordered workflow and rollback limits are documented in
[windows-continuity-lifecycle.md](windows-continuity-lifecycle.md).
