import { memoryTypes } from "../domain/memory.js";
import {
  sourceKinds,
  type CandidateReviewContext,
} from "../domain/ingestion.js";
import {
  reviewPolicyModes,
  type BulkReviewResult,
  type CandidateAutomationResult,
  type CandidatePolicyDecision,
  type PolicyEvaluationCheck,
  type PolicyMutationContext,
  type ReviewPolicy,
  type ReviewPolicyConditions,
  type SetReviewPolicyInput,
} from "../domain/review-policy.js";
import type { IngestionRepository } from "../repositories/ingestion-repository.js";
import type { ReviewPolicyRepository } from "../repositories/review-policy-repository.js";

export class ExplicitPolicyConfigurationRequiredError extends Error {
  public constructor() {
    super("Changing a review policy requires an explicit user action.");
    this.name = "ExplicitPolicyConfigurationRequiredError";
  }
}

function uniqueTrimmed(values: string[] | undefined): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  const normalized = [...new Set(values.map((value) => value.trim()))].filter(
    (value) => value.length > 0,
  );
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeTrustedSources(
  sources: ReviewPolicyConditions["trustedSources"],
): ReviewPolicyConditions["trustedSources"] {
  if (sources === undefined) {
    return undefined;
  }
  const unique = new Map<string, NonNullable<typeof sources>[number]>();
  for (const source of sources) {
    const externalId = source.externalId.trim();
    if (externalId.length > 0) {
      unique.set(`${source.kind}\u0000${externalId}`, {
        kind: source.kind,
        externalId,
      });
    }
  }
  return unique.size === 0 ? undefined : [...unique.values()];
}

function normalizeConditions(
  conditions: ReviewPolicyConditions = {},
): ReviewPolicyConditions {
  const minimumConfidence = conditions.minimumConfidence ?? 1;
  if (
    !Number.isFinite(minimumConfidence) ||
    minimumConfidence < 0 ||
    minimumConfidence > 1
  ) {
    throw new Error("Policy minimumConfidence must be between 0 and 1.");
  }
  const minimumSupportingEvidence = conditions.minimumSupportingEvidence ?? 1;
  if (
    !Number.isInteger(minimumSupportingEvidence) ||
    minimumSupportingEvidence < 1
  ) {
    throw new Error("Policy minimumSupportingEvidence must be a positive integer.");
  }
  if (
    conditions.allowedMemoryTypes?.some(
      (type) => !memoryTypes.includes(type),
    ) === true
  ) {
    throw new Error("Policy allowedMemoryTypes contains an unsupported value.");
  }
  if (
    conditions.allowedSourceKinds?.some(
      (kind) => !sourceKinds.includes(kind),
    ) === true
  ) {
    throw new Error("Policy allowedSourceKinds contains an unsupported value.");
  }
  const supportedRetrievalPolicies = ["include", "exclude", "manual"] as const;
  if (
    conditions.allowedRetrievalPolicies?.some(
      (policy) => !supportedRetrievalPolicies.includes(policy),
    ) === true
  ) {
    throw new Error(
      "Policy allowedRetrievalPolicies contains an unsupported value.",
    );
  }

  const trustedSources = normalizeTrustedSources(conditions.trustedSources);
  const trustedProposerIds = uniqueTrimmed(conditions.trustedProposerIds);
  return {
    minimumConfidence,
    minimumSupportingEvidence,
    requireUserAuthoredEvidence:
      conditions.requireUserAuthoredEvidence ?? false,
    ...(trustedSources === undefined
      ? {}
      : { trustedSources }),
    ...(trustedProposerIds === undefined
      ? {}
      : { trustedProposerIds }),
    ...(conditions.allowedSourceKinds === undefined
      ? {}
      : { allowedSourceKinds: [...new Set(conditions.allowedSourceKinds)] }),
    ...(conditions.allowedMemoryTypes === undefined
      ? {}
      : { allowedMemoryTypes: [...new Set(conditions.allowedMemoryTypes)] }),
    ...(conditions.allowedRetrievalPolicies === undefined
      ? {}
      : {
          allowedRetrievalPolicies: [
            ...new Set(conditions.allowedRetrievalPolicies),
          ],
        }),
  };
}

export class ReviewAutomationService {
  public constructor(
    private readonly ingestionRepository: IngestionRepository,
    private readonly policyRepository: ReviewPolicyRepository,
  ) {}

  public setPolicy(
    input: SetReviewPolicyInput,
    context: PolicyMutationContext = {},
  ): ReviewPolicy {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitPolicyConfigurationRequiredError();
    }
    if (!reviewPolicyModes.includes(input.mode)) {
      throw new Error(`Unsupported review policy mode: ${String(input.mode)}`);
    }
    const conditions = normalizeConditions(input.conditions);
    if (
      input.mode !== "manual" &&
      conditions.trustedSources === undefined &&
      conditions.trustedProposerIds === undefined
    ) {
      throw new Error(
        "An automatic review policy requires at least one trusted source or proposer identity.",
      );
    }
    if (
      input.mode === "automatic_explicit" &&
      conditions.trustedSources === undefined
    ) {
      throw new Error(
        "An automatic_explicit policy requires a trusted source identity.",
      );
    }
    const missingSources = this.policyRepository.getMissingTrustedSources(
      conditions.trustedSources ?? [],
    );
    if (missingSources.length > 0) {
      throw new Error(
        `Trusted sources must already exist: ${missingSources
          .map(({ kind, externalId }) => `${kind}:${externalId}`)
          .join(", ")}.`,
      );
    }
    return this.policyRepository.setPolicy({
      ...input,
      conditions,
    });
  }

  public listPolicies(
    scopeId?: string,
    includeInactive = false,
  ): ReviewPolicy[] {
    return this.policyRepository.listPolicies(scopeId, includeInactive);
  }

  public previewCandidate(candidateId: string): CandidatePolicyDecision {
    const facts = this.policyRepository.getCandidatePolicyFacts(candidateId);
    const policy = this.policyRepository.getEffectivePolicy(
      facts.candidate.scopeId,
    );
    if (policy === null) {
      return {
        candidateId,
        outcome: "manual_review",
        policy: null,
        checks: [],
        reasons: ["No applicable policy is configured; manual review is the fallback."],
      };
    }

    const policySummary = {
      id: policy.id,
      name: policy.name,
      version: policy.version,
      mode: policy.mode,
      scopeId: policy.scopeId,
    };
    if (policy.mode === "manual") {
      return {
        candidateId,
        outcome: "manual_review",
        policy: policySummary,
        checks: [],
        reasons: ["The effective policy requires manual review."],
      };
    }

    const checks: PolicyEvaluationCheck[] = [];
    const check = (name: string, passed: boolean, detail: string): void => {
      checks.push({ name, passed, detail });
    };
    const candidate = facts.candidate;
    const conditions = normalizeConditions(policy.conditions);
    const supportingEvidence = facts.evidence.filter(
      ({ role }) => role === "supports",
    );
    const trustedSources = new Set(
      (conditions.trustedSources ?? []).map(
        ({ kind, externalId }) => `${kind}\u0000${externalId}`,
      ),
    );
    const trustedProposerIds = new Set(conditions.trustedProposerIds ?? []);
    const verifiedUserEvidence = supportingEvidence.some(
      ({ authorRole, sourceExternalId, sourceKind }) =>
        authorRole?.trim().toLowerCase() === "user" &&
        sourceExternalId !== null &&
        trustedSources.has(`${sourceKind}\u0000${sourceExternalId}`),
    );
    const trustedProposer =
      candidate.proposerId !== null &&
      trustedProposerIds.has(candidate.proposerId);
    const trustedProvenance = verifiedUserEvidence || trustedProposer;
    const normalizedAssertion = candidate.assertion.trim().toLowerCase();
    const exactTrustedEvidenceSupport = supportingEvidence.some(
      ({ sourceContent, sourceExternalId, sourceKind }) =>
        sourceExternalId !== null &&
        trustedSources.has(`${sourceKind}\u0000${sourceExternalId}`) &&
        sourceContent.trim().toLowerCase() === normalizedAssertion,
    );
    const assertionSupportEstablished =
      trustedProposer || exactTrustedEvidenceSupport;

    check(
      "candidate_pending",
      candidate.status === "pending",
      `Candidate status is ${candidate.status}.`,
    );
    check(
      "explicit_candidate",
      candidate.explicitness === "explicit",
      "Inferred candidates always require manual review.",
    );
    check(
      "normal_sensitivity",
      candidate.sensitivity === "normal",
      "Sensitive and restricted candidates always require manual review.",
    );
    check(
      "not_protected",
      !candidate.isProtected,
      "Protected candidates always require manual review.",
    );
    check(
      "not_instruction",
      candidate.type !== "instruction",
      "Instruction candidates always require manual review.",
    );
    check(
      "no_contradicting_evidence",
      !facts.evidence.some(({ role }) => role === "contradicts"),
      "Candidates with contradicting evidence require manual review.",
    );
    check(
      "no_manual_metadata_flag",
      candidate.metadata["requiresManualReview"] !== true,
      "The candidate metadata explicitly requires manual review.",
    );
    check(
      "no_exact_active_match",
      !facts.hasExactActiveMemoryMatch,
      "An exact active-memory match requires manual duplicate/conflict review.",
    );
    check(
      "minimum_confidence",
      candidate.confidence >= (conditions.minimumConfidence ?? 1),
      `Confidence ${candidate.confidence} must meet ${conditions.minimumConfidence ?? 1}.`,
    );
    check(
      "minimum_supporting_evidence",
      supportingEvidence.length >=
        (conditions.minimumSupportingEvidence ?? 1),
      `${supportingEvidence.length} supporting evidence record(s) found.`,
    );
    check(
      "allowed_memory_type",
      conditions.allowedMemoryTypes === undefined ||
        conditions.allowedMemoryTypes.includes(candidate.type),
      `Memory type is ${candidate.type}.`,
    );
    check(
      "allowed_retrieval_policy",
      conditions.allowedRetrievalPolicies === undefined ||
        conditions.allowedRetrievalPolicies.includes(candidate.retrievalPolicy),
      `Retrieval policy is ${candidate.retrievalPolicy}.`,
    );
    check(
      "allowed_source_kinds",
      conditions.allowedSourceKinds === undefined ||
        supportingEvidence.every(({ sourceKind }) =>
          conditions.allowedSourceKinds?.includes(sourceKind),
        ),
      "Every supporting source must use an allowed source kind.",
    );
    check(
      "trusted_provenance",
      trustedProvenance,
      "Trusted user-authored evidence or a trusted proposer identity is required.",
    );
    check(
      "assertion_supported",
      assertionSupportEstablished,
      "The assertion must exactly match trusted evidence unless a trusted proposer attests to the extraction.",
    );

    if (
      policy.mode === "automatic_explicit" ||
      conditions.requireUserAuthoredEvidence === true
    ) {
      check(
        "verified_user_authorship",
        verifiedUserEvidence,
        "Verified user-authored evidence from a trusted source is required.",
      );
    }

    const failed = checks.filter(({ passed }) => !passed);
    return {
      candidateId,
      outcome: failed.length === 0 ? "automatic_accept" : "manual_review",
      policy: policySummary,
      checks,
      reasons:
        failed.length === 0
          ? ["Every automatic-accept condition and manual-only guardrail passed."]
          : failed.map(({ name, detail }) => `${name}: ${detail}`),
    };
  }

  public processCandidate(candidateId: string): CandidateAutomationResult {
    const decision = this.previewCandidate(candidateId);
    if (decision.outcome !== "automatic_accept" || decision.policy === null) {
      return { decision };
    }
    const acceptance = this.ingestionRepository.acceptCandidate(
      candidateId,
      "system",
      `Automatically accepted by review policy ${decision.policy.name} v${decision.policy.version}.`,
      {
        policyId: decision.policy.id,
        policyVersion: decision.policy.version,
        evaluation: decision,
      },
    );
    return { decision, acceptance };
  }

  public processPending(limit = 100): CandidateAutomationResult[] {
    return this.ingestionRepository
      .listCandidates("pending", limit)
      .map(({ id }) => {
        try {
          return this.processCandidate(id);
        } catch (error) {
          return {
            decision: {
              candidateId: id,
              outcome: "manual_review" as const,
              policy: null,
              checks: [],
              reasons: [
                `Automation evaluation failed: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              ],
            },
          };
        }
      });
  }

  public bulkReview(
    candidateIds: string[],
    action: "accept" | "reject",
    note?: string,
    context: CandidateReviewContext = {},
  ): BulkReviewResult {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new Error("Bulk candidate review requires an explicit user action.");
    }
    const results = candidateIds.map((candidateId) => {
      try {
        if (action === "accept") {
          const accepted = this.ingestionRepository.acceptCandidate(
            candidateId,
            "user",
            note,
          );
          return {
            candidateId,
            outcome: "accepted" as const,
            memoryId: accepted.memory.id,
          };
        }
        this.ingestionRepository.rejectCandidate(candidateId, "user", note);
        return { candidateId, outcome: "rejected" as const };
      } catch (error) {
        return {
          candidateId,
          outcome: "failed" as const,
          error: error instanceof Error ? error.message : "Unknown review error",
        };
      }
    });
    return { action, results };
  }
}
