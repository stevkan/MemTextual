# Platform support

MemTextual has two product editions built on the same portable core:

- **MemTextual Developer** is the developer edition for explicit tools,
  integrations, and project-oriented workflows.
- **MemTextual Continuity** is the personal edition for user-controlled memory
  across one or more personas.

These are editions, not separate memory engines. Both use the same domain
rules, SQLite schema, migrations, safeguards, and provider contracts. Packaging,
defaults, interfaces, and installed host integrations may differ.

## Delivery policy

Windows is the initial supported desktop platform for Continuity. The core is
kept portable, with Windows, macOS, and Linux CI gates configured so later
platform releases do not require a redesign. Passing core CI does not by itself
mean that a Continuity installer or unattended host integration is supported on
that operating system.

All editions currently follow the proprietary-first distribution policy in
`docs/proprietary-distribution.md`. Platform support does not grant source-code
or redistribution rights.

| Area | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Core TypeScript, SQLite, migrations, and tests | CI gate configured | CI gate configured | CI gate configured |
| Developer source workflows | Initial target | Compatibility tracked | Compatibility tracked |
| Continuity desktop packaging | MSI adopted; WiX 7 compilation, ICE validation, and synthetic Sandbox install, repair, upgrade, opted-in host provisioning, and removal evidence passed; production signing remains pending | Deferred | Deferred |
| Upgrade, rollback, and removal | Synthetic Sandbox failure rollback, major upgrade, and data-preserving uninstall passed; production-signed release evidence remains pending | Deferred | Deferred |
| Unattended scheduler integration | Adapter, confirmed orchestration, privileged executor, and preview-first installer CLI available; application bundle staged separately | Deferred adapter | Deferred adapter |
| Certificate credential provider | Core provider and confirmed certificate-path ACL protection available | Core provider available; packaging deferred | Core provider available; packaging deferred |
| Dedicated service identity | Planned where appropriate | Platform-specific decision deferred | Platform-specific decision deferred |

The first Linux distribution targets will be selected before packaging work;
support must not be inferred for every Linux variant from an Ubuntu CI result.

## Host integration boundary

Operating-system behavior is isolated behind exported contracts in
`src/platform/host-platform.ts`:

- `HostSchedulerAdapter` installs, inspects, or removes unattended schedules;
- `HostCredentialProvider` resolves a non-secret reference to an in-memory SDK
  credential without serializing the credential into MemTextual configuration;
- `HostServiceIdentityAdapter` manages a dedicated host identity where that is
  an appropriate platform model; and
- `HostIntegrationBundle` assembles only the capabilities available on a host.

Scheduler and service-identity mutations require an
`ExplicitHostMutationContext` whose `explicitUserAction` value is `true`.
Schedule definitions may contain environment-variable names, but not secret
values. No concrete host adapter is selected or installed by the core.

The Windows layer supplies concrete Task Scheduler and local service-
identity adapters over an injectable `WindowsHostOperations` boundary. Its
installer orchestration previews current identity and task state, binds an
exact confirmation to that state and the requested definitions, refuses to
adopt or remove resources without an explicit MemTextual ownership marker,
and rolls back newly created tasks and identities after an installation
failure. Removal intentionally preserves every configured data, certificate,
configuration, and recovery-key path. Original ACLs are ownership-tracked and
restored during rollback and removal. The privileged PowerShell executor now
creates the marked local account, generates and DPAPI-protects its password,
applies explicit ACLs, receives task secrets over standard input, and registers
password-logon tasks with verified ownership manifests. The strict deployment
layout and preview-first elevated installer CLI are available. A pinned-
certificate signed-manifest directory bundle can be assembled, verified, and
staged without overwrite. Authenticode signing of a separately produced installer
is previewed, exactly confirmed, timestamped, and verified without overwriting
its unsigned input. MSI is the selected container, with a previewed and
confirmed per-machine x64 build boundary over the exact verified bundle.
Rollback-paired host-action authoring has compiled and passed WiX 7 MSI
validation with a synthetic test-certificate bundle. A deliberately failed
  opt-in host-action install then proved application and registration rollback in
  Windows Sandbox. A separate successful opt-in run proved owned account,
  batch-logon-right, schedule, and ACL provisioning, a naturally triggered
  unattended backup, verified removal, and exact preservation of external
  synthetic data and recovery material. Installation UI, production signing,
  and public-distribution validation remain required before describing a public
  end-user installer as supported.

## Release gates

A platform may be described as supported only after its intended package or
installation path has been exercised on that platform. At minimum, release
validation must cover installation, database creation and migration, normal
memory operations, backup and restore, encrypted replication, upgrade, and
uninstall behavior that preserves user data by default.

The Windows non-privileged lifecycle can be exercised with
`memtextual-continuity-release validate` as documented in
`windows-release-validation.md`. Its report explicitly records that elevated
dedicated-account and Task Scheduler validation was not run. A separate
combined-confirmation host validator can install, execute, accept, and remove
disposable host resources, but it is never run by the ordinary automated suite.
Actual release-target execution, production-certificate signing,
and the other public-distribution gates remain separate requirements.
