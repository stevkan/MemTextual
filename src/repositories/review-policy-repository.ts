import type {
  CandidatePolicyFacts,
  ReviewPolicy,
  SetReviewPolicyInput,
  TrustedSourceIdentity,
} from "../domain/review-policy.js";

export interface ReviewPolicyRepository {
  setPolicy(input: SetReviewPolicyInput): ReviewPolicy;
  getEffectivePolicy(scopeId: string): ReviewPolicy | null;
  listPolicies(scopeId?: string, includeInactive?: boolean): ReviewPolicy[];
  getMissingTrustedSources(sources: TrustedSourceIdentity[]): TrustedSourceIdentity[];
  getCandidatePolicyFacts(candidateId: string): CandidatePolicyFacts;
}
