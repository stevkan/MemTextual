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

The harness does not create a dedicated local account, modify ACLs, or install
Task Scheduler entries. Its report records that this privileged host validation
was not run. Exercise the preview-first host installation, acceptance, and
removal workflow from `windows-continuity-deployment.md` separately on the
actual Windows release target with explicit elevation and disposable host
resources.

Passing this harness is engineering evidence, not by itself a statement that
the public installer or release is ready. Authenticode, installer-container,
legal, privacy, dependency-notice, and production-signing gates remain as
documented in `proprietary-distribution.md` and `platform-support.md`.
