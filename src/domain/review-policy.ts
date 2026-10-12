import type {
  CandidateAcceptance,
  CandidateEvidence,
  MemoryCandidate,
  SourceKind,
} from "./ingestion.js";
import type { MemoryType, RetrievalPolicy } from "./memory.js";

export const reviewPolicyModes = [
  "manual",
  "automatic_explicit",
  "automatic_threshold",
  "risk_based",
] as const;
export type ReviewPolicyMode = (typeof reviewPolicyModes)[number];

export interface TrustedSourceIdentity {
  kind: SourceKind;
  externalId: string;
}

export interface ReviewPolicyConditions {
  minimumConfidence?: number;
  minimumSupportingEvidence?: number;
  requireUserAuthoredEvidence?: boolean;
  trustedSources?: TrustedSourceIdentity[];
  trustedProposerIds?: string[];
  allowedSourceKinds?: SourceKind[];
  allowedMemoryTypes?: MemoryType[];
  allowedRetrievalPolicies?: RetrievalPolicy[];
}

export interface SetReviewPolicyInput {
  name: string;
  mode: ReviewPolicyMode;
  scopeId?: string;
  conditions?: ReviewPolicyConditions;
}

export interface ReviewPolicy {
  id: string;
  scopeId: string | null;
  name: string;
  version: number;
  mode: ReviewPolicyMode;
  conditions: ReviewPolicyConditions;
  isActive: boolean;
  createdBy: "user";
  createdAt: string;
  deactivatedAt: string | null;
}

export interface PolicyMutationContext {
  actor?: "user" | "system" | "client";
  explicitUserAction?: boolean;
}

export interface CandidateEvidenceFact extends CandidateEvidence {
  sourceId: string;
  sourceKind: SourceKind;
  sourceExternalId: string | null;
  authorRole: string | null;
  sourceContent: string;
}

export interface CandidatePolicyFacts {
  candidate: MemoryCandidate;
  evidence: CandidateEvidenceFact[];
  hasExactActiveMemoryMatch: boolean;
}

export interface PolicyEvaluationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CandidatePolicyDecision {
  candidateId: string;
  outcome: "automatic_accept" | "manual_review";
  policy: Pick<ReviewPolicy, "id" | "name" | "version" | "mode" | "scopeId"> | null;
  checks: PolicyEvaluationCheck[];
  reasons: string[];
}

export interface PolicyAcceptanceAuthorization {
  policyId: string;
  policyVersion: number;
  evaluation: CandidatePolicyDecision;
}

export interface CandidateAutomationResult {
  decision: CandidatePolicyDecision;
  acceptance?: CandidateAcceptance;
}

export interface BulkReviewItemResult {
  candidateId: string;
  outcome: "accepted" | "rejected" | "failed";
  memoryId?: string;
  error?: string;
}

export interface BulkReviewResult {
  action: "accept" | "reject";
  results: BulkReviewItemResult[];
}
