# Continuity first-use installation and acceptance

This is the supported Windows first-use sequence for the current signed
directory bundle or MSI. It keeps application files, the active database, host
state, and backups separate. The MSI installs guided setup and client Start-menu
entries, but it does not replace the explicit host preview, elevated approval,
acceptance, or recovery verification in this workflow. The current build is not
ready for public distribution.

The release provider supplies the signed bundle and its SHA-256 publisher
certificate fingerprint through separate channels. The user chooses every data,
backup, working, and optional off-device location.

## 1. Verify and stage the application

From a trusted MemTextual source checkout, verify the received bundle using the
separately obtained fingerprint. Preview the exact new target, then apply the
unchanged confirmation token as documented in
[windows-continuity-bundle.md](windows-continuity-bundle.md). Staging must
finish without overwriting or merging an existing application directory.

For the following examples:

```powershell
$application = "C:\Program Files\MemTextual Continuity"
$programData = "C:\ProgramData\MemTextual Continuity"
$database = "$programData\data\memtextual.db"
$backups = "D:\MemTextual Backups"
$backupIntervalHours = 24
$publisherFingerprint = "64_HEXADECIMAL_CHARACTERS"
```

After an MSI installation, launch `Set up MemTextual Continuity` from the
Start menu and answer its local prompts. That entry runs the same unified setup
shown below. It does not place the answers in MSI properties or logs. Once
setup succeeds, continue with the host preview in step 4.

The preferred route is the unified setup command:

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\memtextual.js" models
$extractionModel = Read-Host "Enter one model value shown above"
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\memtextual.js" setup `
  --user-name "YOUR_NAME" `
  --persona-name "PERSONA_NAME" `
  --extraction-model "$extractionModel" `
  --backup-directory $backups
```

The `models` command reads the current Codex App Server catalog. Its results are
choices, not an access guarantee; successful inference verifies access. The MSI
guided setup presents the same catalog as a numbered selector and never chooses
a model automatically.

It creates the directories, database, onboarding snapshot, `deployment.json`,
`conversation.json`, and reusable `installation.json`. When it succeeds,
skip manual steps 2, 3, and 5; continue with the host preview in step 4 and the
acceptance gate in step 6.

The manual steps remain available for advanced layouts. Do not place the backup
directory under the active database directory. If `D:` is the same physical
device as the database, it protects against database damage but not loss of
that device.

## 2. Write the deployment configuration

Create the strict, secret-free `deployment.json` described in
[windows-continuity-deployment.md](windows-continuity-deployment.md). Its
`applicationDirectory`, `databasePath`, `backupDirectory`, and `stateDirectory`
must match the paths selected above. Configure the optional off-device section
only after its destination, credential material, and separately retained
recovery key are ready.

## 3. Create the database and first persona

Run the staged setup entry point directly with its bundled Node runtime:

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\continuity-setup.js" setup `
  --user-name "YOUR_NAME" `
  --persona-name "PERSONA_NAME" `
  --backup-directory $backups `
  --database $database `
  --migrations "$application\migrations"
```

Retain the reported snapshot. Record the returned persona ID; later commands
must select that exact persona. Re-running setup with the same identity is
idempotent and must report that it reused, rather than duplicated, the records.

## 4. Preview and install unattended protection

Run preview from a normal terminal:

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\windows-host.js" install-preview `
  --config "$programData\deployment.json"
```

Review the identity, paths, tasks, and confirmation token. Then run
`install-apply` from an elevated terminal with that unchanged token and an
explicit local actor ID. If off-device replication is configured, the elevated
process must also contain the deployment's named recovery-key environment
variable. Do not put the recovery key in a command-line argument or JSON file.

## 5. Configure the conversation runtime

Create the strict, secret-free `conversation.json` described in
[continuity-console.md](continuity-console.md). It must point to the unchanged
deployment file, an explicit extraction model, and the dedicated conversation
working directory. Do not add API keys, grants, passwords, or recovery keys.

## 6. Run the read-only installation acceptance gate

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\continuity-acceptance.js" `
  --persona PERSONA_ID `
  --conversation-config "$programData\conversation.json" `
  --trusted-fingerprint $publisherFingerprint
```

Acceptance succeeds only when all of these checks pass:

- every staged application file matches the signed manifest and the pinned
  publisher fingerprint;
- the deployment and conversation files resolve to direct expected paths;
- the dedicated identity and every configured schedule are installed with the
  expected MemTextual ownership and definitions;
- SQLite integrity and foreign keys are valid;
- the database migration versions exactly match the staged application; and
- the selected persona exists in that database.

The command is read-only. It does not repair, install, migrate, start a model,
run a backup, or mutate a memory. A failure must be resolved at the named layer
and the complete gate rerun; do not bypass a failed check.

## 7. Exercise backup and normal use

After the scheduled task has had an opportunity to run, inspect the same backup
interval configured in `deployment.json`:

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\safeguard.js" status `
  --database $database `
  --output $backups `
  --interval-hours $backupIntervalHours
```

Require a successful, verified recovery point. If off-device replication is
configured, also run its documented status and package-verification checks.
Perform the documented restore drill on the chosen interval; acceptance of task
definitions alone is not evidence that a backup can be restored.

Start the console only after the installation gate succeeds:

```powershell
& "$application\runtime\node.exe" `
  "$application\dist\src\cli\continuity-console.js" `
  --persona PERSONA_ID `
  --conversation-config "$programData\conversation.json"
```

Create an explicit host authorization, start one disposable conversation, send
one non-sensitive turn, and confirm that its exact completed dialogue appears
in the local journal. Candidate creation and acceptance still follow the
configured memory-review policy; a completed turn does not imply that a memory
was accepted.

This first-use check is narrower than the platform release gates. Upgrade,
rollback, restore, encrypted-replication, and data-preserving removal validation
remain required before a public Windows release can be described as supported.
The supported engineering sequence for those application lifecycle operations
is recorded in
[windows-continuity-lifecycle.md](windows-continuity-lifecycle.md).
