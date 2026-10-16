# Proprietary-first distribution

MemTextual Developer and MemTextual Continuity use a proprietary-first release
strategy. Source code is not licensed for public use, modification, or
redistribution. Public application binaries will be distributed only under
separately approved proprietary terms.

This preserves the owner's ability to license, partner, finance, or transfer
the product while market demand and the protectable portions of the technology
are evaluated. The owner may later authorize selected open-source components or
a broader license, but that requires a new explicit decision.

## Repository safeguards

- `package.json` uses `"private": true` so npm refuses publication.
- `package.json` uses `"license": "UNLICENSED"` while the source package is not
  offered under public license terms.
- The Windows bundle builder requires an explicit application-license input and
  never selects legal terms.
- Signing private keys, credentials, databases, memories, and recovery keys are
  excluded from application bundles.

`UNLICENSED` describes the private source package. It is not the eventual
end-user license. When approved proprietary terms exist, release packaging must
include those exact terms and identify them consistently in release metadata.

## Public-release gates

Do not describe a build as publicly distributable until all of these inputs are
explicitly resolved:

1. the legal person or entity that owns and licenses the product;
2. written ownership or assignment records for every contributor;
3. an approved end-user license agreement and privacy disclosures;
4. patent and public-disclosure review where appropriate;
5. trademark clearance for the product and edition names;
6. a complete third-party dependency license and notice inventory;
7. protected production code-signing credentials;
8. production-certificate execution of the implemented Authenticode boundary
   and installer-container selection; and
9. installation, upgrade, rollback, and data-preserving removal validation.

This file records the engineering release policy, not legal terms or legal
advice. The repository must not generate placeholder rights, ownership claims,
or an end-user agreement and present them as approved.
