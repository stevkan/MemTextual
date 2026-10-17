# Automatic backup orchestration

MemTextual can create an everyday recovery point when an explicitly configured
interval has elapsed. The interval must be greater than zero and no more than
24 hours. Nothing installs or enables an operating-system schedule implicitly;
a trusted local scheduler or host must invoke the command regularly.

```powershell
npm run safeguard -- run-if-due -- --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
npm run safeguard -- status -- --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
```

`run-if-due` uses SQLite's online backup API. Every created recovery point has
an integrity-checked database, durable-data export, and manifest, and the new
backup is verified against that manifest before it is reported as successful.
It refuses to reuse an existing timestamp directory.

The destination must differ from the active database directory, and the active
database cannot be inside its backup destination. This prevents the most direct
self-backup configuration errors, but it cannot determine whether two paths are
on separate physical devices. The user or installer must choose an appropriate
destination.

## Status and failures

Each database has a locked, append-only status journal in the destination. The
journal records no memory assertions. It reports:

- `never_run`, `healthy`, `overdue`, or `failed` health;
- the last attempt, successful backup, and verification times;
- the next due time and selected interval;
- the last snapshot directory; and
- the most recent failure requiring action.

Journal records are sequence-numbered and created once rather than replaced,
avoiding Windows rename behavior that can reject otherwise valid updates. An
invalid or corrupt newest record fails closed instead of being ignored. A lock
prevents overlapping runs; a lock left by a terminated process must be reviewed
and removed by an operator only after confirming no backup is running.

## Retention

Retention is preview-first and requires explicit counts, an IANA timezone, and
the first day of the week (`0` for Sunday through `6` for Saturday). No counts
are inferred. At least one daily recovery point must be retained, and the newest
verified recovery point is always kept independently of all buckets.

```powershell
npm run safeguard -- retention-preview -- --database .\data\memtextual.db --output D:\MemTextualBackups --daily 7 --weekly 4 --monthly 12 --time-zone America/Los_Angeles --week-starts-on 0
npm run safeguard -- retention-apply -- --database .\data\memtextual.db --output D:\MemTextualBackups --daily 7 --weekly 4 --monthly 12 --time-zone America/Los_Angeles --week-starts-on 0 --confirm "EXACT TOKEN FROM PREVIEW"
```

The newest snapshot in each retained local-calendar bucket is kept. One
snapshot may satisfy multiple daily, weekly, or monthly buckets. Before a
snapshot can become a deletion candidate, its manifest and required artifacts
must exist, its source database filename and path-derived identity must match,
its database hash must match the manifest, and durable-table verification must
pass. Partial, legacy-without-identity, unrecognized, mismatched, or corrupted
snapshots are protected for manual review rather than deleted.

Application recomputes the preview while holding the same database-specific
lock used by automatic backup. Any changed snapshot set invalidates the prior
confirmation. Targets must still be direct, non-link snapshot directories under
the configured destination. A planned-operation record is written before
deletion and a content-free receipt is retained after success.

## Restore drills

Restore drills prove that a recovery point can be copied and opened without
replacing or opening the live database. The interval is explicit, must be
greater than zero, and cannot exceed 8760 hours (one year).

```powershell
npm run safeguard -- restore-drill -- --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
npm run safeguard -- restore-drill-status -- --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
```

When due, the drill selects the newest verified recovery point, copies it to a
temporary disposable directory, checks its hash, integrity, and durable-table
manifest, then removes the temporary copy. A newer corrupt or incomplete
recovery point, or one whose creation time cannot be established, fails the
drill instead of silently falling back to an older copy. The append-only state
journal reports `never_run`, `healthy`, `overdue`, or `failed`, including the
last successful drill and any failure requiring action. Each attempted drill
writes a report with verified and protected snapshot counts. Automatic backup
creation, retention application, and restore drills share one database-specific
lock.

## Guided live restore

Stop every MemTextual process that can access the active database before a live
restore. Preview the exact verified recovery point first, review its timestamp
and any newer available recovery points, then pass the preview's complete
confirmation string unchanged:

```powershell
npm run safeguard -- restore-preview -- --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot memtextual-2026-10-12T12-00-00-000Z
npm run safeguard -- restore-apply -- --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot memtextual-2026-10-12T12-00-00-000Z --confirm "EXACT TOKEN FROM PREVIEW"
```

The confirmation is bound to the selected backup hash and the current logical
contents of the live database. Any intervening database or backup change makes
it stale. Application holds the shared safeguard lock, creates and verifies a
new pre-restore recovery point, stages and verifies the selected database, and
checks that the live database is not busy before activation. Existing database,
WAL, shared-memory, and rollback-journal files are copied into a temporary
rollback directory before the staged database replaces the live file. The
activated database is verified again before a recovery report is written.

If activation fails, MemTextual restores the original files automatically. A
planned-operation record remains available if the process is interrupted and
manual recovery is required. After a successful recorded restore, the temporary
rollback files are removed and an append-only cleanup receipt is written. If
cleanup or its receipt fails, the command reports a warning and any retained
rollback directory for review; the independently verified pre-restore recovery
point remains in the configured backup destination.

## Encrypted off-device replication

MemTextual can copy one verified local recovery point into an authenticated,
encrypted package at an explicitly selected destination. The destination may be
a removable drive, network share, or user-configured synchronized directory;
MemTextual does not infer whether it is physically separate and does not select
or contact a cloud provider. The destination directory must already exist as a
direct, non-link directory; MemTextual will not recreate a missing mount point
and accidentally place an intended off-device copy on local storage.

The key must be exactly 32 random bytes encoded as canonical base64 in a named
environment variable. `--key-env` passes only that variable's name. The key
value is never accepted as a command-line argument, written into the package,
included in output, or stored by MemTextual. `--key-id` is a non-secret label
used to identify which externally retained key is required for recovery.

```powershell
npm run safeguard -- offsite-export -- --database .\data\memtextual.db --source D:\MemTextualBackups --destination E:\MemTextualOffsite --snapshot memtextual-2026-10-12T12-00-00-000Z --key-env MEMTEXTUAL_OFFSITE_KEY --key-id recovery-key-2026
npm run safeguard -- offsite-run-if-due -- --database .\data\memtextual.db --source D:\MemTextualBackups --adapter local-directory --destination E:\MemTextualOffsite --interval-hours 24 --key-env MEMTEXTUAL_OFFSITE_KEY --key-id recovery-key-2026
npm run safeguard -- offsite-status -- --database .\data\memtextual.db --source D:\MemTextualBackups --adapter local-directory --destination E:\MemTextualOffsite --interval-hours 24
npm run safeguard -- azure-credential-status -- --credential-config C:\ProgramData\MemTextual\azure-credential.json
npm run safeguard -- offsite-run-if-due -- --database .\data\memtextual.db --source D:\MemTextualBackups --destination-config C:\ProgramData\MemTextual\azure-destination.json --credential-config C:\ProgramData\MemTextual\azure-credential.json --interval-hours 24 --key-env MEMTEXTUAL_OFFSITE_KEY --key-id recovery-key-2026
npm run safeguard -- offsite-status -- --database .\data\memtextual.db --source D:\MemTextualBackups --destination-config C:\ProgramData\MemTextual\azure-destination.json --credential-config C:\ProgramData\MemTextual\azure-credential.json --interval-hours 24
npm run safeguard -- offsite-verify -- --package E:\MemTextualOffsite\OFFSITE_PACKAGE_DIRECTORY --key-env MEMTEXTUAL_OFFSITE_KEY
npm run safeguard -- offsite-import -- --database .\data\memtextual.db --package E:\MemTextualOffsite\OFFSITE_PACKAGE_DIRECTORY --destination D:\MemTextualBackups --key-env MEMTEXTUAL_OFFSITE_KEY
```

For scheduler-managed configuration, put the adapter and absolute destination
in the versioned, secret-free JSON format documented in
`replication-destinations.md`, then replace `--adapter ... --destination ...`
with `--destination-config PATH`. Unknown adapters or configuration properties
fail before replication begins. `--destination` alone remains a compatibility
shorthand for `local-directory` and never selects a cloud provider.

Each package encrypts the SQLite recovery point, its safeguard manifest, and
its durable-data export with AES-256-GCM. HKDF-SHA-256 derives a separate key
for each file from the externally supplied master key and a random package
salt; every file receives a fresh nonce and authenticated package metadata.
The plaintext master key and memory artifacts are never written to the package.
The outer replication manifest contains only recovery metadata, cryptographic
parameters, file sizes, and hashes.

Creation holds the local database's shared safeguard lock and refuses corrupt,
partial, mismatched, or changed recovery points. Files are streamed rather than
loaded as one in-memory archive. Before success is reported, MemTextual decrypts
the entire package into a disposable directory, validates every ciphertext and
plaintext hash, and reruns database integrity and durable-table verification.
The disposable plaintext is then removed and an append-only verification report
is retained with the package. Wrong keys and modified ciphertext fail
authentication.

`offsite-run-if-due` is an opt-in hook for a trusted local scheduler. Its
explicit interval must be greater than zero and no more than 8760 hours. When
due, it selects the newest verified local recovery point and repeats the full
encrypted-package verification before recording success. It does not create a
new local snapshot, so automatic local backup should run independently at the
user's chosen cadence. A newer corrupt, incomplete, or otherwise protected
recovery point fails the run instead of silently replicating an older one.

Scheduled replication builds the encrypted package in disposable staging and
publishes it through the provider-neutral destination contract. Both the local
directory and Azure Blob paths write an append-only publication receipt under
the local backup destination. MemTextual materializes the published package in
separate disposable storage, rehashes it, and decrypts and verifies the final
copy before recording success. A publication, materialization, final
verification, or local state failure rolls back the newly published package;
disposable staging is removed on both success and failure.

Replication state is append-only and stored in the local backup destination,
separately for each database and off-device destination. This keeps an
unavailable off-device destination from hiding the recorded failure. Status is
`never_run`, `healthy`, `overdue`, `unavailable`, or `failed` and includes
destination and last-package availability, the last attempt, success,
verification, snapshot, package, key label, next due time, and failure requiring
action. The state contains no encryption key or memory assertions. A local lock
prevents overlapping scheduled runs; a lock left after process termination
requires operator review before removal.

`offsite-import` decrypts and verifies the complete package only in disposable
storage before copying it into the local recovery-point catalog. The package
must carry the exact path-derived identity and database filename of the active
installation. Import uses the shared safeguard lock, refuses to overwrite an
existing snapshot, rehashes and verifies every copied artifact, and writes
planned, success, or failure evidence. It does not open, replace, or otherwise
change the live database. After import, use `restore-preview` and
`restore-apply` for the separately confirmed live activation workflow.

The recovery key must be backed up separately from both the active database and
the encrypted packages. Losing it makes the packages unrecoverable. Azure
upload occurs only when the user explicitly configures the Azure adapter and
invokes the command. This package does not install a system schedule.
