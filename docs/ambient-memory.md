# Ambient memory capture

`AmbientMemoryService` is the provider-neutral capture boundary for the first
MemTextual Continuity ambient-memory slice. A host supplies a versioned
`AmbientMemoryExtractor`; MemTextual imports the interaction, gives the
extractor only that source and the active persona context, validates every
proposal, and creates reviewable memory candidates.

Ambient capture does not bypass candidate review. New proposals default to
`inferred`, confidence `0.5`, and pending status. They become memories only
through explicit user review or an existing user-configured review policy.
Sensitive, restricted, inferred, protected, instruction, conflicting, and
otherwise ineligible candidates remain pending under the existing fail-closed
policy guardrails.

## Persona and provenance boundary

Each proposal must name `episodic` or `durable` as its memory class and cite at
least one record from the captured interaction. The service chooses the active
persona's relationship scope; extractors cannot supply a scope. Migration 011
stores the candidate's source, user, persona, relationship, memory class, and
extractor ID/version in `ambient_candidate_profiles`.

Database triggers reject:

- a persona, relationship, or user ownership mismatch;
- a candidate outside the persona's relationship scope;
- a candidate not attributed to its recorded extractor;
- evidence from another source or a deleted source; and
- changes to recorded ambient provenance.

When an ambient candidate is accepted, the acceptance transaction also creates
its `continuity_memory_profiles` row. Manual and policy-authorized acceptance
therefore produce the same persona-bound result. No accepted ambient memory can
become an unprofiled Continuity memory through the supported path.

## Idempotency

Candidate external IDs are derived from the immutable source version,
extractor ID/version, assertion, type, memory class, and evidence. Reprocessing
the same extraction reuses the existing candidate and review state. A changed
source must use the existing explicit source-versioning workflow.

## Current boundary

This package defines and validates the capture contract; it does not include an
LLM, rules engine, host event listener, sensitive-data classifier, temporal
relevance model, background scheduler, graphical review UI, or MCP tool.
Provider adapters must be configured by a trusted host and must use stable IDs
and versions. Ordinary chat platforms still need an authorized integration to
deliver interactions to this service.
