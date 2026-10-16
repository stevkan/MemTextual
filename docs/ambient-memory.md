# Ambient memory capture

`AmbientMemoryService` is the provider-neutral capture boundary for the first
MemTextual Continuity ambient-memory slice. A host supplies a versioned
`AmbientMemoryExtractor`; MemTextual imports the interaction, gives the
extractor only that source and the active persona context, validates every
proposal, and creates reviewable memory candidates.

`StructuredAmbientMemoryExtractor` adapts an asynchronous local or external
`AmbientExtractionProvider` to that contract. Provider output may be a parsed
object or JSON text, but must contain only a `proposals` array matching the
strict schema. It rejects unknown fields, invalid enums, missing evidence,
invalid confidence, and more than the configured proposal limit before any
candidate is created.

The initial concrete provider is
`CodexAppServerAmbientExtractionProvider`. It runs a bounded extraction task on
an ephemeral Codex App Server thread, uses application developer instructions
to label the serialized conversation as untrusted data, and constrains the
final message with a JSON output schema. It requires an explicit model string,
which is recorded in the extractor version, and sends only the selected persona
and relationship names, source identity, and up to 100 source records. Persona,
relationship, source, and record metadata are not forwarded. Input over 256
KiB fails visibly rather than being silently truncated.

The task uses the same no-approval, read-only sandbox with no readable roots as
the conversation adapter. App Server output still passes through the strict
provider validator and the ordinary evidence, persona, sensitivity, and review
boundaries. Evidence excerpts, when present, must occur verbatim in the cited
source record; a generated or paraphrased excerpt fails before candidate
creation. Extraction does not itself accept a candidate as memory.

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
assessment, and normalized temporal fields. Reprocessing the same extraction
and assessment reuses the existing candidate and review state. Changed source,
classifier, or temporal values preserve new provenance rather than rewriting an
earlier candidate.

## Temporal relevance

An extractor may supply `validFrom`, `validTo`, and `reviewAfter` as ISO 8601
timestamps with a timezone. MemTextual normalizes them to UTC, rejects invalid
timestamps and reversed validity windows, and copies them through the candidate
into the accepted immutable revision. Database triggers guard candidate and
revision writes, including callers outside the TypeScript service.

Validity and review are separate. Normal retrieval excludes a memory before
`validFrom` and after `validTo`. A caller may explicitly include out-of-window
results for history or review; each result reports `current`, `not_yet_valid`,
or `expired`. `reviewAfter` only sets `reviewDue`; it does not hide, rewrite,
archive, or delete the memory. Validity bounds are inclusive.

## Current boundary

This package defines and validates the capture, structured-provider, and
explicit temporal contracts and includes the initial Codex App Server
extraction adapter. It does not include a concrete sensitivity classifier,
temporal inference model, background listener, scheduler, or MCP capture tool.
Without a configured classifier, extracted proposals remain fail-closed as
unassessed sensitive candidates and cannot be automatically accepted. The
Codex provider must still be composed by the trusted Continuity runtime with an
explicit model. Ordinary chat platforms still need an authorized integration
to deliver events; see `host-capture.md`.
