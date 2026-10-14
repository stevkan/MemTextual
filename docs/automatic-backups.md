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

This package does not yet delete old recovery points, perform disposable restore
drills, replace a live database, encrypt off-device copies, or install a system
schedule. Those remain separate Phase 6 controls because each needs explicit
retention, recovery, destination, or credential choices.
