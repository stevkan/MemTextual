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

## Sensitivity assessment

A host may supply a versioned `AmbientSensitivityClassifier`. It receives the
proposal, its cited records, the captured source, and the active persona
context, then returns `normal`, `sensitive`, or `restricted`, a confidence from
0 through 1, and short machine-readable reason codes. Reason codes must not
contain source excerpts or personal details.

If no classifier is configured, the service records an `unassessed` result and
assigns `sensitive`; it never assumes `normal`. A completed classification may
raise but cannot lower a sensitivity declared by the extractor. Sensitive and
restricted candidates cannot be accepted by review automation. If manually
accepted, they retain their sensitivity and remain excluded from default
persona retrieval unless the caller explicitly permits that class.

Migration 012 records assessment status, declared and assessed sensitivity,
confidence, classifier identity/version, and reason codes. Database triggers
reject malformed assessments or a candidate whose effective sensitivity is
lower than either its declared or assessed value. Schema-11 rows are preserved
as `legacy_unassessed` without rewriting their candidate state.

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
extractor ID/version, assertion, type, memory class, evidence, and sensitivity
assessment. Reprocessing the same extraction and assessment reuses the existing
candidate and review state. Changed source or classifier versions preserve new
provenance rather than rewriting an earlier candidate.

## Current boundary

This package defines and validates the capture contract; it does not include an
LLM, built-in extraction or sensitivity model, rules engine, host event listener,
temporal relevance model, background scheduler, graphical review UI, or MCP
tool. Provider adapters must be configured by a trusted host and must use stable
IDs and versions. Ordinary chat platforms still need an authorized integration
to deliver interactions to this service.
