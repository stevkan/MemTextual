# Windows MSI packaging

MSI is the adopted Windows installer container for MemTextual Continuity. The
package is per-machine and x64 because the supported Windows deployment uses a
dedicated local account, protected machine paths, and Task Scheduler resources.

The initial MSI boundary packages application files only. It does not yet
create the account, change ACLs, register tasks, create data directories, or run
the application. Those host mutations remain in the existing preview-first
host integration and will be connected through separately rollback-tested,
deferred installer actions.

## Build safeguards

- Input must be a complete Continuity directory bundle verified against the
  explicitly trusted publisher fingerprint.
- The MSI contains the exact bundle manifest inventory plus its manifest,
  signature, and public certificate. Wildcard harvesting is not used.
- Application files install under `Program Files\MemTextual\Continuity`.
- Each file receives a stable component identity and an explicit key path.
- The package uses one stable upgrade code and blocks downgrades.
- The release owner or manufacturer is a required build input. MemTextual does
  not invent a legal entity.
- Preview binds the bundle manifest, WiX executable and hash, WiX version,
  output path, manufacturer, version, scope, and upgrade code to an exact
  confirmation token.
- Apply refuses overwrite, builds into an isolated temporary workspace, checks
  the Windows Installer compound-file signature, and runs `wix msi validate`
  before publishing the verified bytes through a create-only copy. A failed or
  malformed build never replaces the selected release path.

Microsoft specifies `ALLUSERS=1` for per-machine installation. WiX maps its
`perMachine` package scope to that setting:

- <https://learn.microsoft.com/windows/win32/msi/allusers>
- <https://docs.firegiant.com/wix/schema/wxs/packagescopetype/>

## WiX boundary

MemTextual does not download or install WiX. The build requires a user-supplied
WiX 7 executable and the explicit `--accept-wix-eula` flag on every preview and
apply invocation. WiX 7 binary releases have a separate Open Source Maintenance
Fee EULA, including a revenue threshold; acceptance and any resulting obligation
belong to the release owner, not to MemTextual:

- <https://docs.firegiant.com/wix/whatsnew/>
- <https://github.com/wixtoolset/wix/blob/main/OSMFEULA.txt>

WiX 7 is required rather than the older fee-free release because WiX's published
consumer security-fix period for WiX 5 ended in February 2026:

- <https://docs.firegiant.com/wix/>

## Commands

After independently obtaining WiX 7 and reviewing its terms, preview:

```powershell
npm run windows-msi -- preview `
  --bundle C:\release\memtextual-continuity-windows-x64-0.8.0 `
  --output C:\release\MemTextual-Continuity-0.8.0-unsigned.msi `
  --wix C:\path\to\wix.exe `
  --manufacturer "APPROVED RELEASE OWNER" `
  --trusted-fingerprint BUNDLE_CERTIFICATE_SHA256 `
  --accept-wix-eula
```

Apply with the unchanged inputs and exact returned confirmation:

```powershell
npm run windows-msi -- apply `
  --bundle C:\release\memtextual-continuity-windows-x64-0.8.0 `
  --output C:\release\MemTextual-Continuity-0.8.0-unsigned.msi `
  --wix C:\path\to\wix.exe `
  --manufacturer "APPROVED RELEASE OWNER" `
  --trusted-fingerprint BUNDLE_CERTIFICATE_SHA256 `
  --accept-wix-eula `
  --confirm BUILD-WINDOWS-MSI-EXACT_TOKEN
```

The result remains unsigned. Pass it through the separately confirmed
[Authenticode workflow](windows-authenticode.md) before release testing.

## Remaining installer work

1. Add rollback-capable deferred host-provisioning and removal actions.
2. Prove install, repair, major upgrade, rollback, and data-preserving uninstall
   on a disposable Windows target.
3. Add an approved EULA and installation UI after legal ownership and terms are
   resolved.
4. Build, validate, Authenticode-sign, and test a real release candidate with
   approved production tooling and credentials.
