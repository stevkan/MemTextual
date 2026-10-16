# Windows Continuity upgrade, rollback, and removal

Continuity uses side-by-side signed application directories. An upgrade never
overwrites the currently accepted application, and the old signed directory is
retained until the new version has passed installation acceptance. The active
database, backups, host state, configuration, credentials, and conversation
workspace remain outside every application directory.

This workflow assumes the first installation already passed
[continuity-first-use.md](continuity-first-use.md). It is an engineering
lifecycle for the signed directory bundle. Equivalent MSI lifecycle actions and
public updater behavior remain release work.

## Before upgrading

- Obtain the new signed bundle and its publisher fingerprint through separate
  trusted channels.
- Stop every Continuity console and other process that can write the database.
- Keep the current signed application directory and its unchanged deployment
  configuration.
- Select a new, absent application directory for the new version.
- Do not delete a pre-upgrade snapshot until the new version is accepted and
  its rollback window has intentionally ended.

## Validate the database upgrade without changing it

Stage the new bundle into its new application directory. Then run its upgrade
validator against the active database:

```powershell
& "C:\Program Files\MemTextual Continuity 0.9.0\runtime\node.exe" `
  "C:\Program Files\MemTextual Continuity 0.9.0\dist\src\cli\continuity-upgrade.js" validate `
  --database "C:\ProgramData\MemTextual Continuity\data\memtextual.db" `
  --backup-directory "D:\MemTextual Backups" `
  --migrations "C:\Program Files\MemTextual Continuity 0.9.0\migrations"
```

The command acquires the same database-specific lock used by backup and restore
operations, creates a verified online snapshot, copies only that snapshot into
disposable storage, applies the new migrations there, checks SQLite integrity
and foreign keys, and verifies every pre-upgrade durable table, column, row
count, and content hash. It then proves that the active database and its applied
migration list did not change.

Success writes `upgrade-validation-report.json` beside the retained snapshot.
A migration or preservation failure writes
`upgrade-validation-failure.json`, retains the verified snapshot, removes the
disposable database, and fails the upgrade. Never proceed after a failed
validation.

## Activate the new version

1. Preview and apply host removal using the unchanged old deployment file.
   This removes only verified MemTextual-owned tasks and its managed identity,
   restores recorded ACLs, and preserves all data and configuration paths.
2. Create a new deployment file whose `applicationDirectory` is the new staged
   directory. Keep the same explicitly selected database, backup, host-state,
   and optional off-device settings.
3. Run the new staged `continuity-setup.js setup` with the existing `--user-id`
   and `--persona-id`. It creates another verified pre-change snapshot, applies
   migrations to the live database, and reuses the selected identities rather
   than creating replacements.
4. Preview and apply host installation with the new deployment file.
5. Create or update the secret-free conversation configuration to reference the
   new deployment file.
6. Run the new version's complete read-only installation acceptance gate.
7. Exercise backup status, a restore drill when due, and one non-sensitive
   conversation capture as described in the first-use workflow.

Keep the old application, old deployment file, pre-upgrade snapshot, and new
upgrade reports until this sequence succeeds.

## Roll back

Application rollback is not the same as database rollback. An older application
may not understand a schema migrated by a newer version.

If activation fails before the live database is migrated, remove any newly
installed host resources and reinstall the old host configuration; the old
application and database are unchanged.

If the live database was migrated, stop all writers, remove the new host
integration, and use the separately confirmed guided-restore workflow to
restore the retained pre-upgrade snapshot before reinstalling the old host
configuration. Restoring that snapshot discards changes made after it was
created. Therefore, do not use this rollback after normal work has resumed
without first preserving and reconciling newer user data. Prefer a forward fix
when post-upgrade data must be retained.

After rollback, rerun the old installation acceptance gate. Do not report
rollback success merely because the old application starts.

## Data-preserving removal

First preview and apply host removal using the installed deployment file. Then
preview removal of the signed application directory:

```powershell
memtextual-windows-bundle remove-preview `
  --bundle "C:\Program Files\MemTextual Continuity 0.9.0" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS
```

Apply the returned unchanged token:

```powershell
memtextual-windows-bundle remove-apply `
  --bundle "C:\Program Files\MemTextual Continuity 0.9.0" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS `
  --confirm REMOVE-WINDOWS-BUNDLE-EXACT_TOKEN
```

Removal first verifies the exact signed inventory and pinned publisher, so an
application directory containing changed or additional files is rejected
rather than recursively treated as an application-only target. The confirmed
operation removes that application directory only.

The active database, backup and off-device recovery points, host-state files,
deployment and conversation configurations, credential files, recovery key,
conversation workspace, and other external copies are not removed. Removing
those records is a separate data-destruction decision and is not implied by
uninstalling the application.
