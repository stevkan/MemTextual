# MemTextual Continuity

MemTextual Continuity is the user-facing edition of MemTextual for persistent,
user-controlled memory across friendly personas such as companions, counselors,
or advisors. It shares MemTextual Core with the developer-facing edition while
using different defaults, interfaces, and distribution.

In product naming, **MemTextual Developer** means the developer edition and
**MemTextual Continuity** means the personal edition. They share one core and
data model; they are not independent or incompatible memory systems.

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
7. **Distribution:** proprietary-first licensing, authenticated streamable HTTP,
   explicit ChatGPT MCP/plugin integration, installers, and separately packaged
   Developer and Continuity editions. Opening selected components later remains
   an explicit owner decision rather than a release prerequisite.
8. **Expansion:** legacy adapters, administration, and a public REST interface.

## Platform delivery strategy

Continuity will finish its first supported desktop release on Windows. The core
must remain cross-platform during that work: Windows, macOS, and Linux run the
same automated test, type-check, and build gates, and operating-system behavior
is kept behind scheduler, credential-provider, and service-identity contracts.

This establishes portability without claiming that the macOS or Linux personal
edition is complete. Concrete installers, unattended schedules, secure
credential storage, service identities, upgrade paths, and uninstall behavior
remain platform-specific release work. macOS and selected Linux distributions
will be prioritized from actual demand after the Windows release rather than
delaying Windows completion for equal-day support.

Windows now has a side-by-side signed-bundle lifecycle: prospective migrations
run only on a verified snapshot copy, the prior application and snapshot remain
available through acceptance, rollback restores the pre-upgrade database before
an older application is reactivated, and application removal is separately
confirmed from host removal while external data is preserved. A non-privileged
release-candidate harness now exercises that lifecycle with synthetic data and
retained evidence. The separately approved elevated dedicated-account and Task
Scheduler validator is now available, while executing it on the actual Windows
release target and retaining its evidence remains a release gate.

MemTextual Developer uses the same portability boundary. Source-level
compatibility may become available before an officially supported packaged
experience, but support claims require platform-specific installation,
migration, backup, restore, replication, upgrade, and data-preserving uninstall
validation. The current support matrix and release gates are recorded in
`docs/platform-support.md`.

The first vertical slice targets one persona while retaining the multi-persona
data model and isolation rules from the start.

## Conversation-host boundary

The Continuity conversational client will own the conversations conducted
through it and submit each completed turn to the ambient-memory pipeline. The
provider-neutral `ConversationHost` contract now isolates that runtime, and its
initial concrete adapter implements Codex App Server's local JSONL stdio
protocol. Persona binding, context composition, and authorized ambient-capture
routing are now implemented in the library orchestration layer. Completed turns
are journaled before extraction, failed capture is visible and retriable without
another model turn, and retry remains authorization- and persona-bound. Missing
journal entries can now be reconstructed from exact paginated host history after
full-history validation. A process-local client coordinator now enforces that
reconciliation, unresolved-capture checking, and host resumption occur before a
persisted conversation can accept another turn. It permits one active turn and
closes readiness after failures without retaining bearer grants. The
provider-neutral conversation boundary now carries explicit, persona-bound
start-time behavior without deriving it from memories or persona descriptions.
The local control console now stores immutable, explicitly user-authored
behavior revisions for each persona; new conversations snapshot the current
enabled revision. The console now lists persisted conversations for its bound
persona and presents exact locally journaled turns plus unresolved recovery
counts. A provider-neutral protected grant boundary now stores newly issued
conversation grants outside SQLite, revokes authorization when storage fails,
and has an initial Windows CurrentUser-DPAPI adapter. A grantless client facade
now resolves canonical persona and conversation bindings and loads the bearer
internally for start, reopen, and send; browser-facing operations do not accept
the grant. The Windows console can now explicitly compose that runtime from a
secret-free configuration bound to the installed deployment. Its graphical
controls create or revoke authorization, start or open-and-reconcile a
conversation, send and leave, and retry failed capture. The initial Codex App
Server provider runs bounded ephemeral structured tasks, records its configured
model in its version, and passes output through the existing fail-closed
validator. A separate bounded Codex structured task now classifies every
proposal with a fixed reason-code vocabulary and a declared-sensitivity floor.
The runtime invokes existing user-configured review automation only after that
assessment; it does not create a policy. Provider-confirmed host deletion and a
separately confirmed active-database journal purge are also implemented. Other
cloud providers and local models are outside the initial scope and may be
reconsidered only in response to demonstrated need.

As of October 15, 2026, OpenAI's official ChatGPT desktop, web, and mobile
clients expose no supported outbound conversation-turn API or webhook through
which MemTextual could passively receive every completed turn. Ordinary ChatGPT
passive capture is therefore an unavailable external-platform capability, not
deferred MemTextual work. ChatGPT MCP/plugin integration may support explicit or
model-selected tool calls, but it must not be described as passive or complete
turn capture. Browser scraping, desktop interception, and other unsupported
observation mechanisms are outside the product design. This boundary should be
reassessed only if OpenAI documents a suitable authorized event interface.

## Distribution ownership

MemTextual Developer and MemTextual Continuity use a proprietary-first release
strategy. The source package remains private and unlicensed for redistribution;
public application binaries will require separately approved proprietary terms.
The build and packaging tools do not invent the legal owner, EULA, privacy
terms, patent position, trademark rights, or third-party notices. Those release
inputs must be explicitly established before public distribution. The complete
policy and release gates are recorded in `docs/proprietary-distribution.md`.

## Deferred combined launcher

A combined launcher or bootstrapper may eventually let a user choose
MemTextual Developer, MemTextual Continuity, or both. This is explicitly
deferred until both editions are independently functional, complete,
distributable through their edition-appropriate delivery mechanisms, and
validated through installation, upgrade, rollback, and removal. The
launcher would be a convenience layer over separate edition components; it must
not merge their privilege requirements, configuration, privacy expectations,
or update and removal boundaries. It is not a prerequisite for either edition's
initial release.

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
delivered through a URL fragment. The console includes a conversation catalog
whose detail view preserves exact journaled dialogue and distinguishes local
journal state from unreconciled host history. When explicitly configured, its
visible controls use the grantless client facade to create or revoke
authorization, start or open-and-reconcile conversations, send turns, leave
process-local readiness, and retry failed capture. The protected store is never
populated from browser input, and the browser never receives a raw grant. The
console also includes a
versioned persona-memory JSON export with complete revision histories, plus
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
remain a subsequent explicit package. A provider-neutral publication contract
now constrains adapters to already-encrypted artifacts, validates exact
byte-and-hash parity, records local receipts, and rolls back publications whose
returned evidence fails validation. The included local-directory adapter is the
reference implementation. Scheduled local-directory replication now uses the
contract with disposable encrypted staging, publication receipts, final-copy
decryption and verification, and rollback if publication, verification, or
state recording fails. Scheduler configuration now explicitly selects the
adapter through command options or a strict versioned file that rejects unknown
providers and secret credential fields. Version-1 local-directory health state
remains readable while new state records the selected adapter ID and version.
The Azure Blob destination adapter uses create-only uploads, downloads and
rehashes every remote artifact, and rolls back only blobs it created. Its
configuration retains a non-secret credential reference but rejects credential
material. A certificate provider now resolves that reference for unattended
use, reports certificate validity and expiration, and refuses unusable
credentials. Scheduled Azure publication is materialized into disposable
storage and fully decrypt-verified before success is recorded. Concrete
operating-system schedule installation, dedicated service-account creation,
certificate ACL provisioning, and installer UX remain separate host work.

The first Windows host-integration layer is now in place. Windows Task
Scheduler and local service-identity adapters share an injectable privileged-
operation boundary, while install and removal orchestration use exact fresh
confirmations bound to current host state. Existing unmanaged accounts or
tasks are never adopted or removed, partial installation rolls back resources
created by that attempt, and removal preserves all data and credential paths.
The elevated PowerShell executor now implements account creation, random
password generation, DPAPI-protected account and task secrets, explicit
read-or-modify ACL application, and limited password-logon task registration.
Its bounded TypeScript bridge keeps secrets off command lines and validates all
executor responses. A strict secret-free deployment contract now maps an
explicit bundled-runtime layout, database, backup location, optional offsite
configuration, and intervals into managed schedules. The preview-first Windows
installer CLI requires exact fresh confirmation for application and removal,
validates recovery-key material before mutation, and restores recorded original
ACLs during rollback and removal. A Windows x64 directory-bundle builder now
validates the pinned runtime, copies the lockfile-defined production dependency
set, signs the exact byte-and-hash inventory, pins publisher trust by certificate
fingerprint, and verifies both disposable staging and the final copy. File
staging is separately previewed and confirmed and never overwrites an existing
target. MSI is now the selected Windows container, with confirmed unsigned-build
and Authenticode boundaries. Synthetic Windows Sandbox validation has proved
failed-install rollback, normal install, repair, major upgrade, and
data-preserving uninstall. Successful opted-in host provisioning through the
MSI and public release UX remain separate work; no host change occurs merely by
importing or configuring these layers.

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
