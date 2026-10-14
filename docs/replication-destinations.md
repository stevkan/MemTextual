# Replication destination adapters

MemTextual defines a provider-neutral contract for publishing an already
encrypted, already verified off-device package to another storage destination.
The contract is library-only at this stage. No cloud provider is selected,
configured, authenticated, or contacted by default.

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

The existing safeguard commands are not yet routed through this general
adapter contract. Integrating scheduled replication with an adapter selected
through explicit user configuration is the next package. Concrete cloud
adapters remain separate provider-specific work.
