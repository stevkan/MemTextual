# Candidate semantic matching

## Purpose

MemTextual can accept a provider-neutral `CandidateSemanticMatcher` that compares
a pending candidate with eligible active memories and returns advisory match
proposals. The core does not depend on a model vendor, embedding service, or
network transport.

The default build still provides deterministic exact-normalized matching without
configuring a semantic provider.

## Provider contract

A matcher receives:

- the pending candidate; and
- active memories of the same type that share the candidate's scope.

It may propose `semantic_duplicate`, `semantic_refinement`,
`semantic_conflict`, or `semantic_related`. Every proposal supplies a target
memory ID, score from zero through one, and a non-empty explanation. Every
matcher has a stable ID and version so review output identifies its provenance.

MemTextual validates all output. It rejects an unknown or out-of-scope target,
an invalid match kind or score, an empty explanation, or missing matcher
identity. Exact-normalized results take precedence when a semantic provider
also proposes the same memory.

## Safety boundary

Matches are review aids, not decisions. Finding or displaying a match:

- does not accept or reject the candidate;
- does not create, revise, reaffirm, contradict, or supersede a memory;
- does not grant a review policy permission to act automatically; and
- does not bypass protected-memory or explicit-user requirements.

Only the trusted resolution workflow can apply a match, and it records the
selected outcome separately in `candidate_resolutions`.

## Privacy

A matcher receives candidate and memory assertions and metadata represented by
the domain objects. A future adapter that sends this material to an external
provider must require explicit configuration, disclose the destination, honor
sensitivity restrictions, and avoid transmission by default. No external
semantic provider is included or enabled in the current build.
