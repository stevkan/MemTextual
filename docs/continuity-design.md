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

Phase 1 memory correctness is complete. Phase 2 includes additive user,
persona, and relationship identities, an enforced namespace-scope hierarchy,
explicit episodic-versus-durable memory classification, and a persona-aware
retrieval path that denies cross-persona recall by default. This completes the
planned Persona Foundations phase.

Phase 3 now includes a provider-neutral ambient capture boundary. Recorded
interactions can now produce idempotent, evidence-backed candidates bound to
one persona relationship and an explicit episodic or durable class. Candidates
remain pending by default; the existing user-configured review policies are the
only automatic-acceptance path, and accepted candidates are transactionally
profiled as persona memories. Ambient sensitivity assessment is also in place:
classifiers are provider-neutral and versioned, classifications cannot lower
protection, and missing classification fails closed to sensitive. Explicit
validity windows and review dates now flow from ambient proposals through
candidates into immutable memory revisions. Default retrieval excludes memories
that are not yet valid or have expired, while an explicit historical query can
include them with a temporal status; expiration never deletes or changes a
memory's lifecycle state. A strict structured-output adapter now supports
asynchronous extraction providers, while explicit persona-scoped host grants,
versioned event adapters, deterministic replay protection, and immutable
successful-capture receipts form the authorized host-event boundary. Concrete
vendor clients, credentials, and event subscriptions remain deployment work;
they are not implicitly enabled by the library.

Phase 4 includes a persona-scoped Continuity control service. It exposes
ambient review queues with resolved evidence, candidate reconciliation,
persona-memory listing and immutable revision history, direct correction,
pinning, protection, lifecycle transitions, recoverable deletion, and confirmed
purge. Every mutation requires an explicit user action, and both candidate and
memory targets are checked against the selected persona before delegation to
the existing policy services. A first local graphical console now presents the
pending candidate queue, resolved evidence, persona-memory list, immutable
history, candidate acceptance or rejection, pinning, protection, archive, and
restore. It now also displays match suggestions, supports explicit revise,
reaffirm, contradict, supersede, and ignore outcomes against persona-validated
targets, and creates immutable direct-correction revisions. It binds to one
persona and IPv4 loopback for one process lifetime, with a fresh bearer token
delivered through a URL fragment. The console also includes a versioned
persona-memory JSON export with complete revision histories, plus
exact-ID-confirmed recoverable deletion and restoration. The export is
intentionally described as a user-memory record rather than a database backup:
it excludes source, candidate, audit, ranking, emotional-annotation, and backup
data, and downloaded copies are not changed by later privacy actions. Graphical
confirmed purge is implemented
as a separately guarded flow because it is irreversible: it requires a fresh
impact preview, prior deletion, an operational reason, exact-ID confirmation,
separate permanent-removal and external-copy acknowledgements, and returns an
assertion-free receipt. Phase 4's planned local user-control surface is complete;
broader administration and source-series controls remain separate.

Phase 5 now has its first additive foundation. An injected provider-neutral
embedding interface identifies its provider, model, and fixed vector dimensions;
provider output must be finite, dimensionally exact, and non-zero. Embeddings
bind to immutable memory revisions, so an edit cannot reuse stale semantic data.
The opt-in hybrid path combines lexical reciprocal rank and cosine similarity
over a bounded candidate pool while preserving the existing persona, policy,
sensitivity, lifecycle, and temporal boundaries. The ordinary lexical path
remains the default, and MemTextual does not select or contact an external
embedding provider on its own.

Persona-aware ranking now uses a separate immutable profile history for every
persona. The default preserves the established 0.35 lexical and 0.65 semantic
blend while making an explicit user pin and directly stated memories visible
ranking signals. Here, directly stated follows the stored revision's
`explicitness` field; it is not a claim that the assertion is objectively true.
Users can explicitly revise those weights and independently
boost episodic or durable memory for a persona; optimistic revision checks
prevent silent overwrites. Each hybrid result explains the applied signals and
boost, and its audit event records the profile revision. Ranking profiles are
durable user configuration covered by database safeguards.

Emotional relevance is now available only through explicit user annotation. A
memory revision may receive revisioned valence, activation, and salience values;
these are user-provided relevance cues, not inferred psychological states or
medical findings. The default emotional ranking weight is zero. Emotional
alignment affects hybrid ranking only after the user explicitly enables a
non-zero persona weight and the query supplies an emotional context. Raw query
values are omitted from retrieval audits, stale annotations do not cross memory
revisions, and permanent memory purge removes and accounts for the annotations.
Automatic emotion inference is intentionally outside this package.

Bounded context composition completes the planned Phase 5 retrieval-quality
work. Persona-safe hybrid results can now be serialized as versioned,
structured memory data under exact UTF-8 and item budgets with optional
episodic and durable caps. Assertions are either included verbatim or omitted
whole. Only selected items receive use counters and retrieval audits, so an
item considered during ranking is not falsely recorded as used when a context
limit excludes it. Consumers are required to treat the payload as untrusted
contextual data rather than higher-authority instructions.

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

Phase 6 now has its first additive foundation. A trusted local scheduler can
invoke an opt-in `run-if-due` command using a user-selected interval of no more
than 24 hours and a destination outside the active database directory. Every
created recovery point reuses the online snapshot, integrity manifest, and
durable export, then verifies the backup against its manifest before recording
success. A locked, append-only journal exposes never-run, healthy, overdue, and
failed status plus the last attempt, success, verification, next due time, and
failure requiring action. MemTextual does not silently install a system
schedule.

Configurable retention is now also available as a separate preview-and-apply
control. Users must explicitly choose daily, weekly, and monthly counts, an IANA
timezone, and a week-start day; at least one daily point and the newest verified
snapshot are always retained. Only complete snapshots with a matching
path-derived source identity whose database hash and durable-table verification
pass can become deletion
candidates. Incomplete, corrupt, mismatched, and unrecognized snapshots fail
closed to protected. Application holds the backup lock, recomputes the preview,
requires its exact current confirmation, validates every direct non-link target,
and writes a planned-operation record plus a completed receipt. Restore drills
now run at an explicitly configured interval against the newest verified
recovery point in a disposable directory without opening the live database.
Their append-only status and reports expose the last verified restore and any
failure requiring action; a newer protected recovery point fails closed rather
than triggering fallback. Guided live restore now adds an exact preview-bound
confirmation, a newly verified pre-restore recovery point, busy-database check,
verified staging and activation, automatic failure rollback, interruption
records, and append-only completion and cleanup reports. All writers must be
stopped before activation. Provider-neutral encrypted replication can now write
a verified recovery point to an explicit removable, network, or synchronized
destination without choosing or contacting a cloud provider. It streams the
database, safeguard manifest, and durable export through AES-256-GCM with
per-file HKDF-derived keys, authenticates package metadata, and verifies the
completed package through disposable decryption. The 32-byte master key remains
external and must be retained separately. An authenticated package can now be
imported into the matching installation's local recovery catalog after complete
disposable verification, without touching the live database or overwriting an
existing recovery point. An opt-in scheduler hook now replicates the newest
verified local point at an explicit interval and maintains local append-only
never-run, healthy, overdue, unavailable, and failed status. It fails closed
when a newer protected point exists, requires an already-mounted destination,
and does not install a system schedule. Concrete cloud destination adapters
remain a subsequent explicit package.

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
