# Changelog

This file records user-visible changes to MemTextual. The files under `docs/`
describe only the current design and behavior.

## Unreleased

- Added a fail-closed Windows installer UI boundary using WiX's minimal wizard.
  MSI preview and apply now require a direct approved-EULA RTF; its path, byte
  count, and SHA-256 hash are confirmation-bound and the staged copy is rehashed
  before compilation. The official WiX UI extension must be installed and its
  version must exactly match the WiX executable. A full synthetic bundle and
  synthetic non-production RTF compiled into a 52,344,161-byte MSI and passed
  WiX 7 validation. No product EULA, legal owner, or distribution terms were
  invented or approved by this work.

- Proved the successful opt-in MSI host lifecycle in a clean,
  network-disabled Windows Sandbox using synthetic data. Installation created
  the owned dedicated account, batch-logon right, ACL grants, and scheduled
  backup; the naturally triggered task completed with result `0` and created a
  recovery point. Uninstall removed all owned host resources and ownership
  records while preserving the database, configuration, and recovery point.
  The host executor now handles Windows' 48-character local-user description
  limit, uses a resolvable machine-qualified task account, grants and revokes
  `SeBatchLogonRight`, avoids an invalid infinite task repetition duration,
  waits through Task Scheduler's running result, and verifies restored ACL
  ownership, group, entries, order, and control state before deleting its
  recovery manifest.

- Exercised synthetic unsigned `0.8.0` and `0.8.1` MSIs in a fresh,
  network-disabled Windows Sandbox. The run passed deliberately failed
  host-action install rollback, normal install, exact-file repair, major
  upgrade with a single current product registration, and data-preserving
  uninstall. It preserved external synthetic data and deployment configuration
  byte-for-byte. Production signing, approved legal terms, and public-release
  validation remain separate gates.

- Added an optional, preview-bound MSI build workspace so WiX native cabinet
  creation can use a short unprotected path independently of the final output
  directory. WiX now receives its own isolated intermediate directory. A full
  test-certificate bundle with 11,812 packaged files compiled and passed WiX 7
  MSI validation through the MemTextual wrapper; this is test-certificate build
  evidence, not a production-signed release.

- Added opt-in MSI host integration using the existing ownership-checked Windows
  host service. `MEMTEXTUAL_HOST_ACTIONS=1` enables deferred, non-impersonating,
  hidden-target account, ACL, and schedule actions against the fixed secret-free
  deployment file. Install and uninstall have paired rollback actions; ordinary
  uninstall preserves all user data and recovery material, and major upgrades
  leave stable owned host resources in place. Real WiX compilation and failed
  host-action rollback and successful opted-in host provisioning have now been
  exercised.

- Adopted MSI as the Windows Continuity installer container and added a
  preview-first unsigned MSI build boundary. It accepts only an exactly verified
  signed-manifest bundle, emits an explicit per-machine x64 file inventory with
  stable component and upgrade identities, requires a user-supplied WiX 7 binary
  plus per-invocation EULA acceptance, refuses output overwrite, verifies the MSI
  compound format, runs WiX ICE validation in an isolated workspace, and only
  then publishes through a create-only copy. The
  release manufacturer remains an explicit input, and privileged host actions
  remain a separately tested next step.

- Added a format-neutral Windows Authenticode boundary for a future installer
  artifact. A read-only preview binds the exact unsigned artifact, SignTool
  executable, certificate-store thumbprint, timestamp URL, and output path to a
  confirmation token. Apply signs only a new copy with SHA-256 and an RFC 3161
  timestamp, requires Authenticode policy verification, rechecks the untouched
  source, and removes incomplete output on failure. No private-key material or
  PFX password is accepted through the command interface; production-certificate
  execution remains a release gate.

- Added a separately confirmed elevated Windows host lifecycle validator. It
  binds a release-validated synthetic workspace to the exact signed candidate,
  refuses production-style identities and pre-existing resources, provisions
  the dedicated account and backup task, verifies host acceptance, requires the
  managed task to create a recovery point successfully, then removes the task
  and account, restores ACLs, and preserves the synthetic database. Ordinary
  tests never invoke this elevated mutation path.

- Added a non-privileged Windows Continuity release-candidate validation
  harness. Against an explicitly selected signed bundle, prior migration set,
  and absent workspace, it uses synthetic data to exercise signed staging,
  database creation, memory retrieval, backup and restore drill, encrypted
  replication import, prospective and live upgrade, acceptance, rollback, and
  data-preserving application removal. Its retained report explicitly marks
  dedicated-account and Task Scheduler mutation as a separate elevated opt-in
  test rather than claiming it ran.

- Added a Windows Continuity lifecycle workflow for side-by-side upgrades,
  rollback, and data-preserving application removal. Upgrade validation locks
  against backup/restore work, retains a verified snapshot, migrates only a
  disposable copy, verifies durable-data and live-database preservation, and
  records success or failure evidence. Signed application removal is separately
  previewed and exactly confirmed, refuses modified or additional files, and
  leaves every external data, backup, configuration, credential, and recovery
  path untouched.

- Added a read-only Windows Continuity installation acceptance gate. It pins
  the staged bundle publisher, verifies the complete signed inventory, confirms
  the managed host identity and schedules are already installed, checks SQLite
  integrity, foreign keys, exact migration parity, and the selected persona,
  and resolves the explicit Codex conversation configuration without mutating
  the installation. The signed bundle now requires setup, console, and
  acceptance entry points, and the ordered first-use workflow documents the
  remaining backup and live-conversation checks without claiming public-release
  readiness.

- Added the initial concrete Codex App Server sensitivity classifier and wired
  it into the Continuity conversation runtime. All proposals from one captured
  interaction are classified in a separate bounded structured task with strict
  indexed output, fixed reason codes, and a declared-sensitivity floor. The
  runtime now evaluates the existing user-configured review policy afterward;
  it creates no policy, and every existing automation guardrail still applies.

- Added permanent local conversation-journal purge after provider-confirmed
  host deletion. A persona-bound, state-fingerprinted preview counts captured
  turns, host events, source lineage, and candidates; retained-memory evidence,
  trusted-source policies, incomplete provenance, and repeat purge attempts
  block the action. Exact confirmation and retained-copy acknowledgements gate
  one transactional deletion, while immutable conversation, host-deletion, and
  assertion-free purge receipts remain and external backups are not claimed as
  erased.

- Added coordinated external host-thread deletion for Continuity conversations.
  A persona-bound preview supplies state-sensitive exact confirmation; the user
  must acknowledge retained local data and backups before deletion. Attempts are
  durably journaled before provider use, Codex `thread/delete` success is
  validated, deleted threads cannot be reopened or sent new turns, and the UI
  explicitly retains the MemTextual journal and avoids complete-erasure claims.

- Added graphical Continuity conversation controls over the grantless loopback
  API. A user can explicitly create or revoke persona-bound host authorization,
  start or reconcile a conversation, send and leave, and retry a failed capture
  without generating another response. The page retains only process-local
  readiness IDs, never receives protected grants, preserves completed output in
  the durable journal after capture failure, and requires visible recovery
  before reopening.
- Added opt-in packaged activation for the Windows Continuity conversation
  runtime. One strict, secret-free conversation configuration references the
  existing deployment paths and explicitly selects the Codex adapter,
  extraction model, and dedicated working directory. Startup rejects deployment
  path drift and unsafe path inputs; shutdown stops the listener, Codex host,
  and SQLite in dependency order while attempting every close. The graphical
  page remains a read-only conversation journal until chat controls are added.
- Added an optional grantless conversation API to the loopback Continuity
  console server. Token-protected, same-origin routes can explicitly create,
  list, and revoke persona-bound host authorization; start, reopen, leave, and
  send conversations; retry failed capture without another model response; and
  surface recovery-required states. Browser inputs
  cannot select user, persona, relationship, host, event permissions, or raw
  grants. A completed model response remains visible if ambient capture fails,
  while the raw exception stays server-side. The packaged CLI and graphical
  page remain disabled until runtime configuration and chat controls are added.
- Added trusted Continuity conversation runtime composition. A single
  server-side boundary now wires the Codex conversation host and structured
  ambient extractor to persona behavior, local lexical memory context,
  authorized exact-turn capture, durable recovery journals, protected grant
  resolution, and the grantless client facade. The Windows factory uses the
  DPAPI grant store, runtime shutdown closes the owned host exactly once, and
  the caller-owned database remains open. The browser console remains read-only
  while its grantless authorization and live-turn endpoints are still pending.
- Added bounded lexical context composition for the default SQLite FTS path, so
  production conversations do not require a model, API key, network call, or
  embedding provider for memory retrieval. Only memories included in the final
  byte- and item-bounded payload receive use counters and context audit events;
  hybrid-only options fail visibly instead of being ignored.
- Added the initial concrete ambient extraction provider for Codex App Server.
  It uses an ephemeral thread, dedicated developer instructions, a strict
  per-turn JSON output schema, an explicit provenance-recorded model, bounded
  untrusted conversation input, and the existing no-approval sandbox. Output is
  validated again before candidate creation, including verbatim evidence
  excerpts; without a concrete sensitivity classifier, proposals remain
  fail-closed as sensitive and pending. Live chat controls remain disabled
  until production runtime composition is complete.
- Added a grantless Continuity conversation client boundary. Start, reopen, and
  send now resolve canonical persona or stored-conversation bindings and load
  protected host grants internally; public client operations do not accept the
  bearer. Expired, revoked, malformed, cross-persona, and mismatched lifecycle
  results fail closed. The console remains read-only until the protected client
  and extraction provider are wired into its production runtime.
- Added provider-neutral protected conversation-grant storage and an initial
  Windows DPAPI adapter. New authorizations can persist their bearer only as a
  CurrentUser-protected, create-once record outside SQLite; storage failure
  revokes the new authorization, full bindings are revalidated before use or
  revocation, and revoked or expired grants are never returned. A real Windows
  DPAPI integration test covers store, restart-safe load, idempotency, and
  deletion. Console chat controls remain separate composition work.
- Added a persona-scoped, read-only conversation catalog to the Continuity
  console. It lists persisted conversations, exact durable journal text, and
  pending or failed capture counts while denying cross-persona detail access.
  The UI explicitly distinguishes local journal state from host history and
  leaves start, reopen, and send unavailable until protected host-grant storage
  exists.
- Added persistent persona-behavior profiles and control-console editing.
  Explicit user-authored revisions are append-only, optimistic, enableable,
  disableable, persona-isolated, and protected by the durable-data safeguards.
  New conversations snapshot the current enabled revision and map its versioned
  provider-neutral contract to Codex App Server `developerInstructions`; older
  and unconfigured conversations remain neutral and unchanged.
- Made Node.js 24.21.0 the exact runtime requirement in package metadata,
  validation, CI, and Windows bundle construction. Runtime-manager-specific
  files and instructions are excluded from the repository.
- Added a process-local Continuity client lifecycle coordinator. Persisted
  conversations reconcile authoritative host history, surface exact unresolved
  capture records, and resume the host before accepting another turn. It
  prevents overlapping turns, closes readiness after failure or leave, and
  retains no bearer grants. The control console now presents its read-only
  journal and recovery state; active chat controls remain separate work.
- Added fail-closed host-history reconciliation. The provider-neutral host
  contract can list exact completed turns, and the Codex adapter pages
  oldest-first full history through `thread/turns/list`. Persona-bound
  reconciliation validates the complete history before mutation, rejects
  ambiguous or mismatched turns, journals missing turns, and captures them
  idempotently without another model response.
- Added durable completed-turn capture recovery. Schema 18 journals exact
  completed dialogue before ambient extraction, records visible generic failure
  state without grants or raw exceptions, and links successful attempts to a
  matching immutable host-event receipt. Persona-bound listing and authorized,
  idempotent retry reuse the original event without generating another model
  response.
- Added persona-bound Continuity conversation orchestration. Immutable schema-17
  bindings connect one host conversation to one persona relationship and
  explicit capture authorization; each turn preflights authorization, composes
  bounded untrusted memory context, preserves the exact user message, waits for
  authoritative host completion, and captures exact user/assistant records
  through the existing ambient safeguards. Cross-persona, revoked, malformed,
  interrupted, and failed-capture paths fail visibly, while the Codex adapter
  applies a restricted read-only sandbox with no approval requests. The chat UI
  and persona-behavior prompting remain open.
- Added the provider-neutral `ConversationHost` contract and an initial Codex
  App Server JSONL stdio adapter. It performs the required handshake, supports
  thread creation and resumption, streams assistant deltas, accepts final text
  only from authoritative completed items, fails closed on unsupported server
  requests and malformed protocol data, and reconnects cleanly after process
  failure. Fake-server tests cover creation, turn submission, streaming,
  completion, errors, concurrency, and restart. Persona binding and ambient
  capture routing remain separate client-integration work.
- Added explicit persona-memory creation to the local Continuity console. The
  user must select the memory class, type, sensitivity, retrieval policy, and
  optional pin/protection state; the server fixes persona ownership and records
  the entry as an explicit user action without fabricating source evidence.
- Added a safeguarded, idempotent Continuity onboarding CLI for inspecting,
  creating, or selecting the local user and persona. Setup requires a verified
  pre-change snapshot, rejects ambiguous or conflicting identity selections,
  validates integrity and foreign keys transactionally, and prints the exact
  persona-bound console launch command without enabling ambient capture.
- Adopted a proprietary-first distribution baseline. Package metadata now
  combines npm's publication block with `UNLICENSED`; public application
  packaging continues to require separately approved proprietary terms and
  does not infer an owner, EULA, or other legal rights.
- Added a Windows x64 Continuity directory-bundle builder and verifier. It
  validates the pinned runtime, includes its license plus explicit application
  terms, selects production dependencies from lockfile version 3, rejects
  links, signs a complete byte-and-SHA-256 inventory, excludes the private key,
  and distinguishes self-consistent integrity from separately pinned publisher
  trust.
- Added preview-bound application-file staging that refuses existing or
  overlapping targets, verifies the final copy, and removes only the new target
  after failure. Bundle publication uses verified copying instead of directory
  rename to avoid reproducible Windows `EPERM` behavior. Authenticode and
  MSI/MSIX packaging remain explicitly separate.
- Added a strict, secret-free Windows Continuity deployment format and
  `memtextual-windows-host` preview/apply CLI for local backup and optional
  encrypted offsite schedules. The fixed layout uses a bundled Node runtime,
  refuses implicit destinations or credentials, validates recovery-key
  material before mutation, and keeps every host change behind a fresh exact
  confirmation.
- Added ownership-tracked Windows ACL restoration. Original security
  descriptors are stored in a restricted manifest and restored after a failed
  new installation or confirmed removal. Ordinary data paths receive additive
  service access so interactive user access is preserved; the certificate
  private key uses the restrictive mode. Databases, backups,
  certificates, configuration, recovery packages, and application files remain
  preserved.
- Formalized MemTextual Developer as the developer edition and MemTextual
  Continuity as the personal edition built on the same core.
- Added Windows, macOS, and Linux CI for the shared TypeScript and SQLite core,
  while retaining Windows as Continuity's initial supported desktop target.
- Added portable host-platform detection and explicit contracts for future
  scheduler, credential-provider, and service-identity adapters. Host mutations
  require explicit user action, and schedule definitions carry secret names but
  not secret values.
- Added an initial Azure Blob encrypted-package destination adapter using the
  pinned official Azure SDK, create-only blob writes, complete remote download
  and SHA-256 verification, and package-scoped rollback.
- Added strict secret-free Azure destination configuration, an unattended
  certificate credential provider with expiration health, remote package
  materialization, final decrypt verification, append-only scheduled health,
  and CLI wiring for Azure Blob replication. Operating-system schedule and
  dedicated-account installation remain explicit later work.
- Added Windows-specific Task Scheduler and local service-identity adapters
  behind an injectable privileged-operation boundary. Installation and removal
  now require fresh preview-bound confirmation, refuse unmanaged identities or
  tasks, roll back newly created host resources after failure, and preserve all
  data and credential paths during removal. Privileged execution remains
  isolated from the orchestration and requires an explicit confirmed apply.
- Added the elevated Windows PowerShell executor and bounded TypeScript bridge.
  The executor generates the local-account password internally, protects
  account and scheduled environment secrets with machine-scoped DPAPI, applies
  explicit read-or-modify ACLs, registers limited password-logon tasks, and
  verifies hashed ownership manifests before inspection or removal. Requests
  and secret values travel through standard input rather than command-line
  arguments. The user-facing installer CLI and deployment contract were added
  separately from the signed bundle and application-file staging workflow.
- Preserved the validated v0.8.0 baseline in a dedicated safety branch and tag.
- Added the initial MemTextual Continuity design and multi-persona isolation
  direction.
- Added consistent online database snapshots, portable durable-data exports,
  integrity manifests, post-upgrade content verification, and verification
  reports.
- Added tests that permit additive schema changes while detecting deleted or
  modified durable records.
- Added deterministic exact-normalized candidate matching and explicit create,
  revise, reaffirm, contradict, supersede, and ignore resolutions.
- Added immutable candidate-resolution records and upgraded the trusted review
  CLI to display matches and apply reconciliation choices.
- Added a provider-neutral semantic matcher contract with validated, attributed,
  advisory duplicate, refinement, conflict, and related suggestions.
- Added explicit immutable source versioning, stable source-series identities,
  retained version reasons, current-source listing, and complete source history.
- Added explicitly authorized recoverable memory deletion, exact-confirmation
  purge, assertion-free purge receipts, retained-copy disclosure, and a trusted
  local privacy CLI.
- Added reversible source-series deletion, dependency-aware purge previews,
  retained-memory and active-policy blockers, exact-confirmation source purge,
  and assertion-free source purge receipts.
- Added Continuity user identities, multiple personas per user, one relationship
  context per persona, transactional scope creation, and database-enforced
  user-to-persona-to-relationship scope ownership.
- Added explicit episodic and durable persona-memory profiles, transactional
  core-memory creation, strict single-relationship scope binding, and purge
  accounting for Continuity profiles.
- Added persona-aware retrieval that resolves relationship scope internally,
  enforces class and sensitivity filters, excludes unprofiled and cross-persona
  memories, and records use only for returned results.
- Added the provider-neutral ambient extraction contract and persona-bound,
  evidence-constrained, idempotent candidate capture with conservative defaults.
- Added database-enforced ambient provenance and transactional transfer of
  accepted candidates into episodic or durable persona-memory profiles.
- Added provider-neutral, versioned ambient sensitivity assessment with
  immutable classifier provenance and machine-readable reason codes.
- Changed unassessed ambient capture to fail closed as sensitive, prevented
  classifiers from lowering declared protection, and enforced both rules in
  the database while preserving schema-11 candidate state.
- Added normalized temporal validity windows and non-destructive review dates
  to candidates and immutable memory revisions, preserving schema-12 data.
- Changed core and persona retrieval to exclude out-of-window memories by
  default while supporting explicit as-of history with temporal and review-due
  status; expiration never mutates or deletes memory state.
- Added strict asynchronous structured-output extraction-provider adapters.
- Added explicit user-issued, persona-scoped host authorizations whose bearer
  grants are stored only as hashes and can be revoked or time-limited.
- Added versioned host-event adapters, deterministic replay protection, and
  immutable successful-capture receipts tied to source and candidate
  provenance.
- Added a persona-scoped Continuity control service for ambient review queues,
  resolved evidence, candidate reconciliation, memory history, correction,
  lifecycle, and privacy operations.
- Added explicit audited pinning and protection mutations and required explicit
  user action for every Continuity control change.
- Added a dependency-free local Continuity control console with a persona-bound
  review queue, evidence and history inspection, candidate acceptance or
  rejection, and pin, protect, archive, and restore controls.
- Bound the console to IPv4 loopback with per-launch bearer authorization,
  same-origin mutation checks, host validation, restrictive browser headers,
  and a token that is delivered in and removed from the URL fragment.
- Added graphical candidate match inspection and explicit revise, reaffirm,
  contradict, supersede, and ignore reconciliation controls with same-persona
  target enforcement.
- Added graphical direct correction that creates an immutable corrected revision
  and clears stale normalized text while preserving prior revision history.
- Added a versioned, persona-isolated JSON memory export containing current
  profiles and complete immutable revision histories without claiming to be a
  database backup or provenance-complete export.
- Added graphical recoverable deletion and restoration with a required reason,
  exact-ID confirmation, explicit user action, and the existing transactional
  tombstone safeguards.
- Added graphical memory-purge preview and confirmed purge with prior-deletion
  enforcement, a fresh server-side eligibility check, exact-ID confirmation,
  separate permanence and external-copy acknowledgements, final browser
  confirmation, and the existing assertion-free receipt.
- Added opt-in provider-neutral embedding generation and persona-safe hybrid
  retrieval with validated vectors, revision-bound derived storage, bounded
  candidate selection, and unchanged lexical retrieval defaults.
- Added immutable per-persona ranking profiles with explicit-user configuration,
  optimistic revision checks, explainable pin, explicit-assertion, episodic, and
  durable boosts, retrieval audit attribution, and safeguard coverage.
- Added explicit, revision-bound emotional annotations using bounded valence,
  activation, and salience values; emotional ranking is disabled by default,
  omits raw context from audits, rejects stale revisions, and participates in
  safeguards and permanent-purge accounting.
- Added persona-scoped bounded context composition with versioned memory-data
  JSON, exact UTF-8 and item limits, optional episodic and durable caps, and
  whole-item omission instead of assertion truncation.
- Changed hybrid retrieval accounting so normal retrieval still records every
  returned result while context composition records only memories actually
  included in the final payload.
- Added opt-in everyday backup orchestration with an explicitly configured
  interval of no more than 24 hours, post-creation manifest verification,
  concurrency locking, and a fail-closed append-only health journal.
- Added user-visible automatic-backup status for never-run, healthy, overdue,
  and failed states without silently installing or enabling a system schedule.
- Changed snapshot creation to refuse reuse of an existing timestamp directory
  rather than risk writing into an earlier recovery point.
- Added preview-first daily, weekly, and monthly backup retention with explicit
  timezone and week-boundary configuration, unconditional newest-snapshot
  preservation, and exact current-preview confirmation.
- Retention protects incomplete, corrupt, source-mismatched, or unverified
  recovery points; application shares the backup lock, validates direct
  non-link targets, and retains planned-operation and completion records.
- Added interval-based restore drills that verify the newest recovery point in
  a disposable copy without opening or replacing the live database.
- Restore-drill state and reports are append-only and fail closed when a newer
  recovery point is corrupt or incomplete rather than silently using an older
  snapshot.
- Added guided live-restore preview and apply commands with confirmation bound
  to the selected recovery point and current logical database contents.
- Live restore creates and verifies a pre-restore recovery point, stages and
  verifies the replacement, preserves database sidecars, rolls back activation
  failures, and records planned, completed, and cleanup evidence.
- Added provider-neutral encrypted replication to an explicitly selected
  destination using streamed AES-256-GCM, per-file HKDF-SHA-256 keys, fresh
  nonces, and authenticated package metadata.
- Encrypted packages are decrypt-verified in a disposable directory before
  success; wrong keys, altered ciphertext, unsafe destinations, and unverified
  local recovery points fail closed without storing the master key.
- Added authenticated off-device package import into the matching local
  recovery-point catalog after disposable decryption and full verification.
- Import shares the safeguard lock, refuses identity mismatches and existing
  snapshot names, records planned, success, or failure evidence, and never
  opens or changes the live database.
- Added an opt-in encrypted off-device `run-if-due` scheduler hook and status
  command with an explicit interval and destination.
- Scheduled replication selects the newest verified local recovery point,
  fails closed for newer protected points, and records append-only local health
  so destination failures remain visible without storing keys or assertions.
- Replication now requires its direct destination directory to exist, avoiding
  accidental local writes when an intended removable or mounted destination is
  unavailable; status reports destination and last-package availability.
- Added a provider-neutral encrypted-package destination contract with strict
  artifact allowlisting, source-manifest checks, adapter-result validation,
  append-only publication receipts, and rollback on invalid evidence.
- Added a reference local-directory adapter that refuses missing, linked,
  overlapping, or existing targets and rehashes every copied artifact. No cloud
  provider is selected or contacted.
- Routed scheduled local-directory replication through the adapter contract
  using disposable encrypted staging and append-only local publication receipts.
- Scheduled success now requires a second decrypt verification of the final
  destination copy; publication, verification, or state-recording failure
  rolls back the newly published package and removes staging.
- Added explicit scheduled-replication adapter selection and a strict,
  versioned, secret-free destination configuration file. Unknown adapters and
  properties fail closed, while prior local-directory state remains readable.

## 0.8.0 - 2026-10-12

- Added the trusted local `memtextual-migrate` CLI and a versioned JSON export
  format for importing memories retained by earlier systems.
- Added one-to-one source-record and candidate creation with preserved legacy
  identity, timestamps, authorship, origin, and metadata.
- Added conservative defaults and mandatory manual-review flags so migration
  cannot silently convert legacy assertions into retrievable memories.
- Added stable candidate external IDs and conflict-safe, idempotent reruns.
- Added schema migration 004 and reported legacy migration as an implemented
  CLI capability through `server_info`.

## 0.7.0 - 2026-10-12

- Added immutable, versioned global and scope-specific candidate-review policies.
- Added `manual`, `automatic_explicit`, `automatic_threshold`, and `risk_based`
  review modes with fail-closed guardrails.
- Added trusted source and trusted proposer configuration.
- Added policy preview, pending-candidate processing, and explicit bulk accept
  and reject operations through the trusted local `memtextual-policy` CLI.
- Added retained policy-evaluation details to candidate audit events.

## 0.6.0 - 2026-10-12

- Added the read-only `server_info` MCP tool.
- Added server identity, version, capability status, and a complete tool catalog
  with safety annotations.
- Kept database contents, credentials, and local runtime paths out of discovery
  responses.

## 0.5.0 - 2026-10-12

- Added the trusted local `memtextual-review` CLI for accepting, rejecting,
  skipping, and inspecting pending candidates.
- Added complete source-record evidence display and optional review notes.
- Added `IngestionService.getSourceRecord` and the `source_record_get` MCP tool.

## 0.4.0 - 2026-10-12

- Added atomic, SHA-256-idempotent source and source-record imports.
- Added pending memory candidates linked to retained evidence.
- Added explicit-user candidate acceptance and rejection with audit history.
- Added transactional acceptance that creates a memory and transfers provenance.
- Added six MCP tools for source import, candidate proposal, and queue inspection.

## 0.3.0 - 2026-10-7

- Added the local stdio MCP server using the official TypeScript SDK.
- Added eleven validated tools for scopes, memory storage, retrieval, and
  lifecycle operations.
- Added configurable database and migration paths and the `memtextual-mcp`
  executable.
- Added in-memory protocol coverage and a real stdio handshake test.

## 0.2.0 - 2026-10-7

- Added the storage-neutral `MemoryService` and repository contracts.
- Added immutable revision history and lifecycle operations.
- Added protected-memory authorization, scope and sensitivity filtering,
  pinned-result ranking, usage tracking, and retrieval audits.

## 0.1.0 - 2026-10-7

- Added the initial SQLite schema and migration runner.
- Added source provenance, scoped and revisioned memories, lifecycle relations,
  entity links, FTS5 search data, embedding metadata, and audit events.
- Added representative seed data.
