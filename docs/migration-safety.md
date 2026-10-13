# Database migration safety

Run these safeguards before applying a new migration to a real MemTextual
database.

## 1. Create a consistent snapshot

```powershell
npm run safeguard -- snapshot -- --database data/memtextual.db --output PATH_TO_BACKUPS
```

The command uses SQLite's online backup API and creates a timestamped directory
containing:

- `memtextual.db`: a consistent, directly restorable database backup.
- `manifest.json`: integrity result, applied migrations, protected table schema,
  row counts, and deterministic content hashes.
- `durable-data-export.json`: a portable export of durable records.

The export contains memory content and should receive the same privacy protection
as the source database. Do not commit any of these artifacts to Git.

## 2. Upgrade a copy first

Copy the snapshot to a disposable location and start the new build against that
copy. MemTextual applies ordered SQL migrations transactionally.

## 3. Verify preservation

```powershell
npm run safeguard -- verify -- --database PATH_TO_UPGRADED_COPY --manifest PATH_TO_MANIFEST
```

Verification fails if SQLite integrity is not `ok`, if a protected table or
column disappeared, or if a durable row count or content hash changed. Additive
tables and columns are permitted. Search indexes and embeddings are excluded
because they are derived and rebuildable. Every verification attempt writes a
timestamped JSON report next to the manifest, including failed attempts.

Only after the disposable upgrade and verification succeed should the same
release be allowed to open the live database. Retain the snapshot until the new
release has been accepted.
