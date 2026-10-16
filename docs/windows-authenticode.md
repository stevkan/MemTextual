# Windows Authenticode release signing

MemTextual has a format-neutral Authenticode boundary for the eventual Windows
installer artifact. It supports `.exe`, `.msi`, `.msix`, `.msixbundle`, `.appx`,
and `.appxbundle` inputs. MSI is now the selected Continuity installer container.

This workflow does not re-sign `runtime/node.exe` in the existing Continuity
directory bundle. That executable is a third-party runtime, while Authenticode
publisher identity belongs on the MemTextual installer or bootstrapper produced
later in the release pipeline. The unsigned artifact is produced by the separate
[MSI workflow](windows-msi.md).

## Trust boundary

- The unsigned artifact, signed output, and SignTool executable must be direct
  regular files at absolute paths.
- The output directory must already exist and the output file must not exist.
- The unsigned and signed artifacts must be different paths with the same
  supported extension.
- The signing certificate is selected from the Windows certificate store by its
  exact 40-hexadecimal-character SHA-1 thumbprint. This value identifies the
  certificate; it is not a private key or secret.
- Only an HTTPS RFC 3161 timestamp URL without embedded credentials is accepted.
- SHA-256 is used for both the file digest and timestamp digest.
- Preview hashes the unsigned artifact and SignTool executable and binds those
  hashes, all paths, the certificate selection, store, and timestamp URL into an
  exact confirmation token.
- Apply recomputes that preview, copies the unsigned artifact without overwrite,
  signs only the copy, and requires `signtool verify /pa /all /v` to succeed.
- The unsigned artifact is hashed again after signing. A changed source fails the
  operation. A signing or verification failure removes the incomplete output; a
  cleanup failure is reported explicitly.

Microsoft documents SignTool as part of the Windows SDK and requires the file
digest option with current SDK builds. Microsoft also recommends SHA-256 and an
RFC 3161 timestamp so a signature can remain verifiable after certificate
expiration:

- <https://learn.microsoft.com/windows/win32/seccrypto/signtool>
- <https://learn.microsoft.com/windows/win32/seccrypto/time-stamping-authenticode-signatures>

## Commands

Preview is read-only:

```powershell
npm run windows-authenticode -- preview `
  --unsigned C:\release\MemTextual-unsigned.msi `
  --signed C:\release\MemTextual.msi `
  --signtool C:\path\to\signtool.exe `
  --certificate-thumbprint CERTIFICATE_SHA1_THUMBPRINT `
  --certificate-store current-user `
  --timestamp-url https://TIMESTAMP_PROVIDER
```

After inspecting the returned paths, hashes, certificate selection, and URL,
apply with the exact preview token:

```powershell
npm run windows-authenticode -- apply `
  --unsigned C:\release\MemTextual-unsigned.msi `
  --signed C:\release\MemTextual.msi `
  --signtool C:\path\to\signtool.exe `
  --certificate-thumbprint CERTIFICATE_SHA1_THUMBPRINT `
  --certificate-store current-user `
  --timestamp-url https://TIMESTAMP_PROVIDER `
  --confirm SIGN-WINDOWS-INSTALLER-EXACT_TOKEN
```

Use `local-machine` only when the release certificate is deliberately installed
in the local-machine certificate store and the signing environment is authorized
to access its private key.

## Current limitation

The workflow is implemented and unit-tested without a production certificate.
It has not signed a real release artifact, because no production signing
certificate or timestamp provider has been approved.

MSI is the adopted container for the first public Windows installer because
Continuity provisions machine-level resources: a dedicated local account, ACLs,
and a scheduled task. Microsoft documents that MSI can run deferred custom
actions with elevated privileges, while MSIX platform capabilities and services
vary by Windows version:

- <https://learn.microsoft.com/windows/win32/msi/custom-action-security>
- <https://learn.microsoft.com/windows/win32/msi/authoring-the-custom-actions>
- <https://learn.microsoft.com/windows/msix/supported-platforms>

The release pipeline must build the unsigned MSI, pass it through this signing
boundary, and then run the existing disposable release and elevated-host
validations against the signed installer result.
