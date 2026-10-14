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

| Area | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Core TypeScript, SQLite, migrations, and tests | CI gate configured | CI gate configured | CI gate configured |
| Developer source workflows | Initial target | Compatibility tracked | Compatibility tracked |
| Continuity desktop packaging | Initial supported target | Deferred | Deferred |
| Unattended scheduler integration | Adapter, confirmed orchestration, and privileged executor available; installer CLI deferred | Deferred adapter | Deferred adapter |
| Certificate credential provider | Core provider available; installer ACL setup deferred | Core provider available; packaging deferred | Core provider available; packaging deferred |
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
configuration, and recovery-key path. The privileged PowerShell executor now
creates the marked local account, generates and DPAPI-protects its password,
applies explicit ACLs, receives task secrets over standard input, and registers
password-logon tasks with verified ownership manifests. An elevated installer
CLI and final application deployment layout are still required before this can
be described as an installable unattended Windows feature.

## Release gates

A platform may be described as supported only after its intended package or
installation path has been exercised on that platform. At minimum, release
validation must cover installation, database creation and migration, normal
memory operations, backup and restore, encrypted replication, upgrade, and
uninstall behavior that preserves user data by default.
