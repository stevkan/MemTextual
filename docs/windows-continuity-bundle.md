# Windows Continuity signed bundle

MemTextual can assemble a self-contained Windows x64 application directory,
sign its complete file inventory, verify it offline, and stage it into a new
installation directory after exact confirmation.

This package provides cryptographic publisher authentication when the verifier
is given the expected certificate SHA-256 fingerprint through a separate trusted
channel. It is not Windows Authenticode signing, an MSI, an MSIX, or a SmartScreen
reputation mechanism. Those public-distribution choices remain separate release
engineering work and must not be inferred from a successful bundle verification.

## Required release inputs

Bundle creation requires:

- a completed production TypeScript build under `dist/src`;
- installed production dependencies matching lockfile version 3;
- the Windows x64 `node.exe` matching the exact `package.json` Node engine;
- the license file shipped with that Node runtime;
- an explicit MemTextual application license or distribution-terms file;
- an unencrypted signing private key kept outside the bundle; and
- its matching X.509 signing certificate, valid at bundle creation time.

The application license is a required input because the packaging workflow must
not choose public, private, open-source, or commercial distribution terms for
the owner. The signing private key is read only for signing and is never copied
into the bundle. The bundled certificate contains only its public certificate
block.

## Create

Run the production build first, then create the bundle in an existing, separate
output directory:

```powershell
npm run build
npm run windows-bundle -- create `
  --source C:\path\to\MemTextual `
  --output C:\path\to\release `
  --runtime C:\path\to\node.exe `
  --runtime-license C:\path\to\Node-LICENSE `
  --application-license C:\secure\MemTextual-LICENSE.txt `
  --signing-key C:\secure\publisher-private-key.pem `
  --signing-certificate C:\secure\publisher-certificate.pem
```

The runtime is executed in a bounded inspection process and must report the
exact pinned Node version, Windows platform, and x64 architecture. The builder
copies `dist/src`, migrations, the Windows executor, package metadata, README,
changelog, runtime and licenses. It reads `package-lock.json` and copies only
installed package entries not marked as development dependencies. Links,
missing required production packages, unsupported filesystem entries, and an
existing final bundle name fail closed.

Bundle construction occurs in disposable staging. The builder creates a sorted
manifest containing the exact relative path, byte count, and SHA-256 hash of
every application file. It signs the exact manifest bytes, verifies the staged
bundle, copies it to a newly created final directory, and verifies that final
copy again. Copy-based publication avoids the Windows directory-rename failure
observed in restricted environments. A failed attempt removes only directories
created by that attempt and never overwrites an existing bundle.

## Verify

The output reports the signing-certificate fingerprint. Distribute that
fingerprint through a separate trusted channel. Verification without a pinned
fingerprint proves internal signature and file integrity but reports
`publisherTrusted: false` because a bundle can otherwise provide its own
untrusted certificate.

```powershell
npm run windows-bundle -- verify `
  --bundle C:\path\to\release\memtextual-continuity-windows-x64-0.8.0 `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS
```

Verification rejects an invalid signature, certificate mismatch, malformed
manifest, changed byte count or hash, missing required entry point, links, and
any missing or additional file.

## Stage application files

The target parent, such as `C:\Program Files`, must already exist. Preview is
read-only and binds the source manifest, publisher fingerprint, complete file
inventory, and currently absent target to an exact confirmation:

```powershell
npm run windows-bundle -- stage-preview `
  --bundle C:\path\to\release\memtextual-continuity-windows-x64-0.8.0 `
  --target "C:\Program Files\MemTextual Continuity" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS
```

Apply the unchanged token in an elevated terminal when the target requires
administrator access:

```powershell
npm run windows-bundle -- stage-apply `
  --bundle C:\path\to\release\memtextual-continuity-windows-x64-0.8.0 `
  --target "C:\Program Files\MemTextual Continuity" `
  --trusted-fingerprint 64_HEXADECIMAL_CHARACTERS `
  --confirm STAGE-WINDOWS-BUNDLE-EXACT_TOKEN
```

Staging never merges with or overwrites a target. It copies into a newly created
directory, verifies the staged copy against the pinned publisher certificate,
and removes only that newly created directory if copying or verification fails.
It does not create the database, backup directory, service account, ACLs,
scheduled tasks, Azure resources, or recovery key. After file staging, use the
separate deployment and host-installation workflow in
[windows-continuity-deployment.md](windows-continuity-deployment.md).
The complete ordered first-use sequence and final read-only gate are documented
in [continuity-first-use.md](continuity-first-use.md).

Application-file removal remains deliberately separate from host removal. The
host removal command preserves application files and user data so an uninstall
cannot silently erase either.
