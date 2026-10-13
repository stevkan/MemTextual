# MemTextual Continuity

MemTextual Continuity is the user-facing edition of MemTextual for persistent,
user-controlled memory across friendly personas such as companions, counselors,
or advisors. It shares MemTextual Core with the developer-facing edition while
using different defaults, interfaces, and distribution.

## Product shape

- **MemTextual Core** owns durable storage, revisions, evidence, scopes,
  retrieval, lifecycle controls, audit records, and migration safety.
- **MemTextual Developer** exposes explicit tools and project-oriented workflows.
- **MemTextual Continuity** adds multiple personas, relationship-aware scopes,
  ambient candidate extraction, conservative review policies, and a graphical
  control surface.

A user may create multiple personas. Each persona receives a separate scope and
relationship context. Cross-persona recall is denied by default and requires an
explicit user-controlled shared scope.

## Initial delivery plan

1. **Memory correctness:** semantic duplicate and conflict resolution; explicit
   create, revise, reaffirm, contradict, supersede, and ignore outcomes; source
   versioning and recoverable purge behavior.
2. **Persona foundations:** user identity, persona and relationship scopes,
   strict per-persona boundaries, and distinct episodic and durable memories.
3. **Ambient memory:** candidate extraction, conservative automatic policies,
   sensitive-data handling, and temporal relevance. Ambient capture produces
   reviewable candidates unless a user-configured policy permits acceptance.
4. **User control:** graphical review, evidence and revision history, correction,
   rejection, protection, forgetting, export, and deletion controls.
5. **Retrieval quality:** optional provider-neutral embeddings, persona-aware
   ranking, temporal and emotional relevance, and bounded context composition.
6. **Operational resilience:** automatic backups, integrity monitoring,
   retention and recovery controls, and optional encrypted off-device
   redundancy for everyday use.
7. **Distribution:** authenticated streamable HTTP, ChatGPT integration,
   installers, and separately packaged Developer and Continuity editions.
8. **Expansion:** legacy adapters, administration, and a public REST interface.

The first vertical slice targets one persona while retaining the multi-persona
data model and isolation rules from the start.

Phase 1 memory correctness is complete. Phase 2 now includes additive user,
persona, and relationship identities, an enforced namespace-scope hierarchy,
explicit episodic-versus-durable memory classification, and a persona-aware
retrieval path that denies cross-persona recall by default. This completes the
planned Persona Foundations phase; ambient memory is the next phase.

## Everyday data durability and recovery

Continuity must protect a user's memories during ordinary daily use, not only
during upgrades. SQLite transactions, foreign keys, and WAL journaling reduce
the risk of inconsistent writes, but they are not backups and do not protect
against disk failure, accidental deletion, ransomware, or unnoticed corruption.

The production design therefore requires:

- automatic online backups on a user-visible schedule, including at least one
  daily recovery point;
- rotating historical backups with configurable daily, weekly, and monthly
  retention rather than a single continuously overwritten copy;
- backup storage separate from the active database, with an optional encrypted
  off-device destination;
- an immediate recovery point before bulk deletion, import, migration, repair,
  or other high-impact automated changes;
- an integrity check, durable-table counts, and deterministic content hashes for
  every completed backup;
- periodic automated restore tests against disposable copies so a backup is not
  considered healthy merely because it exists;
- a user-visible status showing the last successful backup, last verified
  restore, covered time range, destination, and any failure requiring action;
- a guided restore workflow that previews the selected recovery point, preserves
  the current database before replacement, verifies the restored copy, and
  records a recovery report;
- configurable recovery retention for recently deleted memories, with archive
  remaining the default reversible removal action; and
- clear recovery-point and recovery-time expectations so the user can understand
  how much recent activity could be lost and how restoration will work.

Backup contents include private memory data. Local and off-device copies must be
protected accordingly; off-device backups must be encrypted before transfer and
must never silently activate without the user's choice. Backup failure must be
visible and auditable rather than silently ignored.

Exact schedules, retention counts, storage limits, and off-device providers are
configuration decisions. They must not be hard-coded or enabled through an
unstated assumption.

## Non-destructive migration contract

Continuity development must preserve existing MemTextual data by default.

- Every release migration is additive, transactional, ordered, and idempotent.
- A consistent SQLite online backup, durable-data JSON export, and signed-by-hash
  manifest must exist before an upgrade touches a real database.
- The manifest records integrity status, schema versions, durable table counts,
  columns, and deterministic SHA-256 content hashes.
- Post-upgrade verification must prove that every pre-upgrade durable table,
  column, row count, and content hash remains unchanged.
- Existing memory IDs, revisions, evidence, scopes, candidates, policy history,
  and audit records are never silently remapped or discarded.
- Search documents, full-text indexes, and embeddings are derived data. They may
  be rebuilt, but loss of derived data must never remove its durable source.
- Destructive purge remains explicit and separately authorized. Archive is the
  default reversible removal behavior.
- Upgrade tests run against disposable copies, including a representative v0.8
  database, before any migration runs against the live database.
- A failed migration or verification leaves the original database and its
  snapshot available for restoration and emits a migration report.

## Git recovery points

The validated pre-Continuity build is preserved on
`safeguard/pre-continuity-v0.8.0` and tagged `v0.8.0-pre-continuity`. Continuity
work proceeds on `feature/memtextual-continuity` in a separate worktree. Changes
should be committed in small, independently testable phases.
