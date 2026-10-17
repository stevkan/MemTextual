# Configurable candidate-review automation

## Purpose

MemTextual uses persisted, versioned policies that can automatically accept narrowly
eligible memory candidates while preserving manual review as the default and
fail-closed fallback.

Policy configuration and bulk decisions are available only through the trusted
local `memtextual-policy` CLI. MCP clients can propose candidates and benefit
from an already configured policy, but cannot create, replace, or weaken one.

## Modes

| Mode | Behavior |
| --- | --- |
| `manual` | Leaves every candidate pending for explicit review. |
| `automatic_explicit` | Accepts exact user-authored statements from configured trusted sources. |
| `automatic_threshold` | Accepts candidates meeting configured thresholds when provenance is trusted. |
| `risk_based` | Applies the configured thresholds and guardrails; failures remain pending. |

Every non-manual policy requires at least one trusted source or trusted
proposer. `automatic_explicit` specifically requires a trusted source.

## Policy configuration

Policies are immutable versions. Setting a replacement deactivates the current
policy for the same target and inserts the next version. A policy may be global
or attached to a scope. For a candidate, the narrowest active scope policy wins,
then parent scopes, then the global policy. No applicable policy means manual
review.

Example `automatic_explicit` policy:

```json
{
  "name": "Trusted ChatGPT user statements",
  "mode": "automatic_explicit",
  "scopeId": "PROJECT_SCOPE_ID",
  "conditions": {
    "trustedSources": [
      {
        "kind": "chat",
        "externalId": "chat:export:2026-10-12"
      }
    ],
    "minimumConfidence": 1,
    "minimumSupportingEvidence": 1,
    "allowedMemoryTypes": ["preference", "fact", "decision", "goal"]
  }
}
```

A trusted source is the exact `(kind, externalId)` pair and must already exist
when the policy is activated. The external identity is stable. Re-importing
different content is rejected unless the caller explicitly creates a new,
immutable version in that source series.

Example trusted-extractor threshold policy:

```json
{
  "name": "Local extractor threshold",
  "mode": "automatic_threshold",
  "conditions": {
    "minimumConfidence": 0.9,
    "minimumSupportingEvidence": 1,
    "trustedProposerIds": ["extractor:local:v1"],
    "allowedSourceKinds": ["chat", "file"],
    "allowedMemoryTypes": ["preference", "fact", "decision", "goal"],
    "allowedRetrievalPolicies": ["include"]
  }
}
```

MCP candidate proposals cannot supply a trusted proposer ID. That field is
reserved for an installed extractor or other trusted local integration.

## Fail-closed guardrails

Automatic acceptance is refused when any of the following applies:

- no applicable policy exists or the policy mode is `manual`;
- the candidate is inferred, sensitive, restricted, or protected;
- the candidate is an instruction;
- any evidence has the `contradicts` role;
- candidate metadata contains `requiresManualReview: true`;
- an exact active-memory match is found;
- confidence, evidence count, type, source-kind, or retrieval-policy conditions
  fail;
- provenance is not a configured trusted source or trusted proposer; or
- support for the assertion cannot be established.

Without a trusted proposer, the assertion must exactly match a supporting
trusted source record. This deliberately leaves paraphrases pending because
trusted provenance alone does not prove that an extracted assertion is
supported. A trusted proposer may attest to the extraction instead.

Semantic duplicate and contradiction detection is not implemented. Exact active
matches are blocked automatically; other possible conflicts still require the
policy administrator to use conservative scopes and trusted inputs.

## CLI

All commands accept the same `--database` and `--migrations` options as the MCP
and review entry points.

```powershell
npm run policy -- set -- --file .\policy.json --database .\data\memtextual.db --migrations .\migrations
npm run policy -- list -- --database .\data\memtextual.db --migrations .\migrations
npm run policy -- list -- --all --database .\data\memtextual.db --migrations .\migrations
npm run policy -- preview -- --candidate CANDIDATE_ID --database .\data\memtextual.db --migrations .\migrations
npm run policy -- process -- --candidate CANDIDATE_ID --database .\data\memtextual.db --migrations .\migrations
npm run policy -- process -- --pending --limit 100 --database .\data\memtextual.db --migrations .\migrations
npm run policy -- bulk-accept -- --ids ID_1,ID_2 --database .\data\memtextual.db --migrations .\migrations
npm run policy -- bulk-reject -- --ids ID_1,ID_2 --database .\data\memtextual.db --migrations .\migrations
```

`preview` never changes candidate state. `process` accepts only candidates whose
decision is `automatic_accept`; all others remain pending. Bulk operations
require an explicit local user action and process each candidate independently,
so one failure does not roll back successful decisions for other candidates.

## Automatic proposal processing

The production MCP entry point constructs `IngestionService` with
`ReviewAutomationService`. After a candidate is persisted, its effective policy
is evaluated. An eligible candidate is accepted immediately; an ineligible
candidate or an evaluation failure remains pending.

## Audit behavior

An automatic acceptance is recorded as actor `system`. Its retained candidate
event includes:

- `reviewMethod: "automatic"`;
- policy ID and version;
- the complete evaluation result and individual checks; and
- the resulting memory ID.

Policy rows retain their prior versions, activation state, creator, and
timestamps. Policy lifecycle events record creation, activation, and
deactivation.
