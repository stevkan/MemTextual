# Continuity conversation-grant storage

Conversation capture authorizations use bearer grants. SQLite retains only a
SHA-256 hash for authorization checks; the raw grant is not stored in the
database, browser state, command-line arguments, configuration, or logs.

## Provider-neutral boundary

`ConversationGrantStore` defines create, load, and delete operations bound to
the complete authorization identity: authorization, user, persona,
relationship, and host IDs. `ContinuityConversationAuthorizationService`
issues an authorization and immediately writes its raw grant through that
boundary. It returns only the non-secret authorization record.

If protected storage fails, the newly issued authorization is revoked before
the operation reports failure. Revocation validates the full binding before it
changes database state, revokes first, and then removes the protected grant. A
grant is not returned for a missing, expired, revoked, or mismatched
authorization, even if stale protected bytes remain after a deletion failure.

## Initial Windows adapter

`WindowsDpapiConversationGrantStore` uses the existing Windows PowerShell 5.1
bridge. The raw grant crosses only the bridge's bounded standard-input and
standard-output protocol and exists transiently in process memory. The executor
stores one encrypted record per authorization using Windows DPAPI `CurrentUser`
scope with application-specific entropy. It creates records without replacing
existing files, verifies idempotent repeats, restricts the file ACL to the
current identity plus Windows system administrators, validates the complete
binding after decryption, and removes the file on explicit revocation.

`CurrentUser` scope intentionally ties a record to both the Windows machine and
the identity that created it. A different account or another machine cannot use
the copied ciphertext. The eventual unattended client must therefore issue and
store authorizations while running as its dedicated service identity. Database
restore, application reinstall, service-identity replacement, or migration to
another computer requires explicit reauthorization; database backups do not
contain these grants.

## Current boundary

The protected store and authorization lifecycle are implemented and verified,
including a real Windows DPAPI round trip. A provider-neutral protected client
facade now resolves the canonical persona or stored conversation binding and
loads the bearer internally for start, reopen, and send. Its public operations
do not accept a grant, and it rejects expired, revoked, malformed, or
cross-binding resolution and lifecycle results.

The local console server exposes grantless authorization, start, reopen, send,
recovery-retry, and revocation routes. The packaged Windows CLI constructs the
runtime only when given an explicit, secret-free conversation configuration
bound to the existing deployment and database. The graphical page does not call
these routes yet. Browser requests and configuration must never supply the raw
grant.
