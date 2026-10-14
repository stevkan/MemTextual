# Automatic backup orchestration

MemTextual can create an everyday recovery point when an explicitly configured
interval has elapsed. The interval must be greater than zero and no more than
24 hours. Nothing installs or enables an operating-system schedule implicitly;
a trusted local scheduler or host must invoke the command regularly.

```powershell
npm run safeguard -- run-if-due --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
npm run safeguard -- status --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 24
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
npm run safeguard -- retention-preview --database .\data\memtextual.db --output D:\MemTextualBackups --daily 7 --weekly 4 --monthly 12 --time-zone America/Los_Angeles --week-starts-on 0
npm run safeguard -- retention-apply --database .\data\memtextual.db --output D:\MemTextualBackups --daily 7 --weekly 4 --monthly 12 --time-zone America/Los_Angeles --week-starts-on 0 --confirm "EXACT TOKEN FROM PREVIEW"
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
npm run safeguard -- restore-drill --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
npm run safeguard -- restore-drill-status --database .\data\memtextual.db --output D:\MemTextualBackups --interval-hours 168
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
npm run safeguard -- restore-preview --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot memtextual-2026-10-12T12-00-00-000Z
npm run safeguard -- restore-apply --database .\data\memtextual.db --output D:\MemTextualBackups --snapshot memtextual-2026-10-12T12-00-00-000Z --confirm "EXACT TOKEN FROM PREVIEW"
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

This package does not encrypt off-device copies or install a system schedule.
Those remain separate Phase 6 controls because each needs explicit destination
or credential choices.
