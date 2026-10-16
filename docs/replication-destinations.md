# Replication destination adapters

MemTextual defines a provider-neutral contract for publishing an already
encrypted, already verified off-device package to another storage destination.
No cloud provider is selected, configured, authenticated, or contacted by
default.

## Explicit configuration

Scheduled replication accepts an explicit adapter plus destination, or a strict
versioned JSON configuration file. The scheduled CLI currently supports
`local-directory`:

```json
{
  "formatVersion": 1,
  "adapterId": "local-directory",
  "destinationDirectory": "E:\\MemTextualOffsite"
}
```

The destination must be an absolute path. Unknown adapters, format versions,
and properties are rejected. This schema intentionally has no credential,
encryption-key, or key-environment fields. The recovery key remains separately
supplied through the existing environment-variable boundary.

Use `--destination-config PATH` by itself, or use
`--adapter local-directory --destination DIRECTORY`. The older
`--destination DIRECTORY` form remains a compatibility shorthand for
`local-directory`; it never triggers provider discovery or cloud selection.

The programmatic `azure-blob` adapter also has a strict, secret-free
configuration shape:

```json
{
  "formatVersion": 1,
  "adapterId": "azure-blob",
  "accountUrl": "https://ACCOUNT.blob.core.windows.net",
  "containerName": "memtextual",
  "credentialId": "continuity-service-certificate",
  "prefix": "continuity/backups"
}
```

`credentialId` is a non-secret reference. Account keys, connection strings,
SAS tokens, client secrets, and encryption keys are not accepted configuration
properties. Creating the adapter requires an already-authorized Azure
`ContainerClient` whose account and container exactly match the configuration.
The scheduled CLI uses this configuration with a separate strict certificate
credential configuration passed as `--credential-config PATH`:

```json
{
  "formatVersion": 1,
  "credentialId": "continuity-service-certificate",
  "tenantId": "00000000-0000-4000-8000-000000000000",
  "clientId": "00000000-0000-4000-8000-000000000000",
  "certificatePath": "C:\\ProgramData\\MemTextual\\credentials\\azure.pem"
}
```

The PEM must be a direct regular file containing the certificate and its
unencrypted private key. The credential ID must exactly match the destination
configuration. The CLI reports the certificate validity window, SHA-256
fingerprint, and `valid`, `expiring`, `expired`, or `not_yet_valid` health. It
refuses expired and not-yet-valid credentials. The private key is never copied
into MemTextual configuration, state, receipts, or output. The installation
workflow must restrict file access to the dedicated service identity.

## Security boundary

A destination adapter receives only the encrypted package directory. The
allowed artifacts are:

- `database.enc`;
- `durable-data-export.enc`;
- `safeguard-manifest.enc`;
- `replication-manifest.json`; and
- one or more `verification-*.json` reports.

Plaintext database, manifest, and export filenames are rejected, as are links,
subdirectories, and unexpected files. Before invoking an adapter, MemTextual
checks every ciphertext size and SHA-256 digest against the replication
manifest. Every verification report must identify the package and exact
manifest digest and must record a successful three-file verification.

Adapters are trusted local code, but their returned data is still treated as
untrusted. A successful adapter result must return the exact filename, byte
count, and SHA-256 digest for every published artifact. Missing, additional,
duplicated, or changed evidence rejects the result. MemTextual then invokes the
adapter's package-specific rollback operation. The source package is rechecked
after publication so an adapter cannot silently alter it. A rollback failure is
reported together with the original publication failure rather than being
hidden.

## Receipts and secrets

Successful publication writes an append-only local receipt containing the
adapter ID and version, a stable non-secret destination identity, package ID,
opaque package reference, publication time, and verified artifact hashes. The
receipt directory is explicit and must not overlap the encrypted package.

The contract has no field for credentials or encryption keys. Provider
authentication, secret acquisition, retry policy, and remote retention belong
inside a concrete adapter and its trusted host configuration. Adapters must not
return secrets in package references or other receipt fields.

## Local-directory adapter

The included `local-directory` adapter copies the allowlisted artifacts to an
existing direct, non-link directory. It creates a new package directory, never
overwrites an existing package, rehashes every copied file, and removes a
partial newly created target if publication fails. It is the reference
implementation for removable drives, mounted shares, and user-managed sync
directories.

Scheduled local-directory replication is routed through this contract. It
creates the package in disposable encrypted staging, publishes through the
adapter, records the publication receipt locally, verifies the final destination
copy by decrypting it in separate disposable storage, and then records scheduler
success. Publication, final verification, or state-recording failure removes
the newly published package. Manual `offsite-export` remains the direct
single-destination workflow. Concrete cloud adapters remain separate
provider-specific work.

## Azure Blob adapter

The initial `azure-blob` adapter uses the official Azure Storage Blob SDK and
accepts an already-authorized container client. It does not select an identity,
read an account key, create a container, or modify container access policy.

Each package is written under a safe optional prefix and its unique package
name. Every blob upload uses an `If-None-Match: *` create-only condition, so an
existing remote package cannot be overwritten. Only encrypted allowlisted
artifacts are accepted. After upload, the adapter downloads and independently
rehashes every blob before returning byte-and-hash evidence to the provider-
neutral publication contract. A failed upload or mismatch removes only blobs
created by that adapter instance; rollback never performs a broad prefix or
container deletion.

Receipts use a hashed destination identity and an opaque `azure-blob://`
package reference. The Azure account URL, credential reference, and any
authentication material are omitted. Scheduled Azure replication downloads
the newly published package into disposable storage, rehashes every artifact,
decrypts and verifies the complete recovery point, removes the disposable
copy, and records append-only local health. A failure after publication rolls
back only the package created by that run.

The safeguard CLI provides the scheduler-safe `offsite-run-if-due` hook. The
separate Windows host installer can bind it to a confirmed dedicated-account
schedule, protect the configured certificate path, and restore its original ACL
during removal. The signed-manifest Windows directory-bundle workflow separately
creates, verifies, and stages the application files. The MSI and Authenticode
boundaries are implemented separately; completed host actions and real release
validation remain later work.
