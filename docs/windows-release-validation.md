# Windows Continuity release-candidate validation

The release-candidate harness exercises the complete non-privileged Windows
application and data lifecycle with synthetic data. It never opens or migrates
the user's active database. The caller must provide an absent absolute
workspace directory; the harness refuses to reuse one or overlap it with the
candidate bundle or baseline migrations.

## Inputs

- A signed Windows Continuity directory bundle.
- The publisher certificate SHA-256 fingerprint obtained through a trusted
  channel.
- A direct directory containing the migrations for the installed version from
  which the candidate is expected to upgrade.
- An absent absolute workspace path on the Windows machine being validated.

The candidate must contain its target migrations. The workspace stores only
synthetic validation data and retained evidence, but it is intentionally not
deleted automatically so a failed or successful run can be audited.

## Run the non-privileged lifecycle

From a development checkout:

```powershell
npm run continuity-release -- validate `
  --bundle "D:\release\memtextual-continuity-0.9.0" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS `
  --baseline-migrations "D:\release\memtextual-continuity-0.8.0\migrations" `
  --workspace "D:\release-validation\continuity-0.9.0-run-001"
```

From an installed package, run the bundled runtime and CLI entry point instead:

```powershell
& "C:\Program Files\MemTextual Continuity 0.9.0\runtime\node.exe" `
  "C:\Program Files\MemTextual Continuity 0.9.0\dist\src\cli\continuity-release-validation.js" validate `
  --bundle "D:\release\memtextual-continuity-0.9.0" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS `
  --baseline-migrations "D:\release\memtextual-continuity-0.8.0\migrations" `
  --workspace "D:\release-validation\continuity-0.9.0-run-001"
```

The harness performs these phases in order:

1. Verify and stage the signed bundle into the disposable workspace.
2. Create the baseline database and prove a synthetic memory can be retrieved.
3. Create a verified backup and complete a restore drill.
4. Create, authenticate, verify, and import an encrypted recovery package with
   an ephemeral in-memory key.
5. Validate the migration on a snapshot copy, migrate the disposable live
   database, and run database acceptance.
6. Restore the retained pre-upgrade snapshot and verify the baseline schema and
   memory.
7. Remove only the staged application and prove the external database and
   recovery artifacts remain.

Success writes `release-validation-report.json`. Failure writes
`release-validation-failure.json` with the completed phases and error message.
Neither report contains the ephemeral replication key.

## Separate elevated host gate

The non-privileged harness does not create a dedicated local account, modify
ACLs, or install Task Scheduler entries. Its report records that this privileged
host validation was not run. A separate preview-first command can exercise
those boundaries on a disposable Windows release target.

Create an empty `host-validation-backups` directory inside the completed
release-validation workspace. Leave `host-validation-state` absent. Create a
backup-only deployment file with:

- `applicationDirectory` set to the same signed candidate bundle recorded by
  the workspace marker;
- `databasePath` set to `WORKSPACE\data\memtextual.db`;
- `backupDirectory` set to `WORKSPACE\host-validation-backups`;
- `stateDirectory` set to `WORKSPACE\host-validation-state`;
- a unique identity beginning with `MTValidate`, using no more than 20 safe
  characters; and
- no `offsite` section.

Run the read-only preview from a normal terminal:

```powershell
npm run windows-host-validation -- preview `
  --config "D:\release-validation\host-validation-deployment.json" `
  --workspace "D:\release-validation\continuity-0.9.0-run-001"
```

Review the exact identity, ACL paths, backup schedule, preservation boundary,
and combined lifecycle confirmation. Then run apply from an elevated terminal
with that unchanged token:

```powershell
npm run windows-host-validation -- apply `
  --config "D:\release-validation\host-validation-deployment.json" `
  --workspace "D:\release-validation\continuity-0.9.0-run-001" `
  --confirm VALIDATE-WINDOWS-HOST-EXACT_TOKEN `
  --actor local-user
```

Apply refuses pre-existing identities or schedules. It installs the dedicated
account and schedule, verifies host acceptance, starts the managed schedule and
requires a successful result plus a new recovery point, then removes the task
and account, restores recorded ACLs, and proves the synthetic database remains.
It attempts ownership-checked cleanup after a failure and records any incomplete
cleanup as requiring immediate manual attention. Success writes
`elevated-host-validation-report.json`; failure writes
`elevated-host-validation-failure.json`.

This operation changes Windows accounts, ACLs, and Task Scheduler state. It is
never part of the ordinary automated test suite and must be run only after an
explicit preview review on a disposable release target.

Passing this harness is engineering evidence, not by itself a statement that
the public installer or release is ready. Authenticode, installer-container,
legal, privacy, dependency-notice, and production-signing gates remain as
documented in `proprietary-distribution.md` and `platform-support.md`.
