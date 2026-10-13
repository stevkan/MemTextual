import type {
  Explicitness,
  Memory,
  MemoryType,
  RetrievalPolicy,
  Sensitivity,
} from "./memory.js";

export const sourceKinds = ["chat", "file", "manual", "app", "api"] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const sourceRecordKinds = [
  "message",
  "section",
  "entry",
  "event",
  "other",
] as const;
export type SourceRecordKind = (typeof sourceRecordKinds)[number];

export type CandidateStatus = "pending" | "accepted" | "rejected";
export type CandidateActor =
  | "user"
  | "extractor"
  | "system"
  | "import"
  | "client";
export type EvidenceRole = "supports" | "contradicts" | "context";

export const candidateResolutionKinds = [
  "create",
  "revise",
  "reaffirm",
  "contradict",
  "supersede",
  "ignore",
] as const;
export type CandidateResolutionKind = (typeof candidateResolutionKinds)[number];

export interface ImportSourceRecordInput {
  kind: SourceRecordKind;
  content: string;
  authorRole?: string;
  authorName?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportSourceInput {
  kind: SourceKind;
  title: string;
  originUri?: string;
  externalId?: string;
  createVersion?: boolean;
  versionReason?: string;
  capturedAt?: string;
  metadata?: Record<string, unknown>;
  records: ImportSourceRecordInput[];
}

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  originUri: string | null;
  externalId: string | null;
  contentHash: string;
  capturedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  recordCount: number;
  seriesId: string | null;
  versionNumber: number | null;
  previousSourceId: string | null;
  versionReason: string | null;
  isCurrent: boolean;
  deletedAt: string | null;
  deletionReason: string | null;
}

export interface SourceMutationContext {
  actor?: CandidateActor;
  explicitUserAction?: boolean;
}

export interface DeleteSourceSeriesInput {
  kind: SourceKind;
  externalId: string;
  reason: string;
}

export interface SourceSeriesIdentity {
  kind: SourceKind;
  externalId: string;
}

export interface SourceSeriesPurgePreview extends SourceSeriesIdentity {
  seriesId: string;
  isDeleted: boolean;
  versionCount: number;
  recordCount: number;
  dependentMemoryIds: string[];
  dependentCandidateIds: string[];
  activeReviewPolicyIds: string[];
  blockers: string[];
  canPurge: boolean;
  externalCopiesNotModified: true;
}

export interface PurgeSourceSeriesInput extends SourceSeriesIdentity {
  reason: string;
  confirmation: string;
}

export interface SourceSeriesPurgeReceipt extends SourceSeriesIdentity {
  receiptId: string;
  purgedAt: string;
  deletedRowCounts: Record<string, number>;
  externalCopiesNotModified: true;
}

export interface SourceRecord {
  id: string;
  sourceId: string;
  ordinal: number;
  kind: SourceRecordKind;
  authorRole: string | null;
  authorName: string | null;
  content: string;
  contentHash: string;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SourceImportResult {
  source: Source;
  records: SourceRecord[];
  created: boolean;
}

export interface CandidateEvidenceInput {
  sourceRecordId: string;
  role?: EvidenceRole;
  excerpt?: string;
}

export interface CandidateEvidence {
  sourceRecordId: string;
  role: EvidenceRole;
  excerpt: string | null;
}

export interface ProposeMemoryCandidateInput {
  externalId?: string;
  assertion: string;
  type: MemoryType;
  scopeId: string;
  evidence: CandidateEvidenceInput[];
  normalizedAssertion?: string;
  explicitness?: Explicitness;
  confidence?: number;
  observedAt?: string;
  retrievalPolicy?: RetrievalPolicy;
  sensitivity?: Sensitivity;
  isPinned?: boolean;
  isProtected?: boolean;
  proposedBy?: CandidateActor;
  proposerId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryCandidate {
  id: string;
  externalId: string | null;
  status: CandidateStatus;
  assertion: string;
  type: MemoryType;
  scopeId: string;
  evidence: CandidateEvidence[];
  normalizedAssertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  observedAt: string | null;
  retrievalPolicy: RetrievalPolicy;
  sensitivity: Sensitivity;
  isPinned: boolean;
  isProtected: boolean;
  proposedBy: CandidateActor;
  proposerId: string | null;
  reviewedBy: CandidateActor | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  acceptedMemoryId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateReviewContext {
  actor?: CandidateActor;
  explicitUserAction?: boolean;
  note?: string;
}

export interface CandidateAcceptance {
  candidate: MemoryCandidate;
  memory: Memory;
}

export interface CandidateResolutionInput {
  outcome: CandidateResolutionKind;
  targetMemoryId?: string;
}

export interface CandidateResolution {
  candidateId: string;
  outcome: CandidateResolutionKind;
  targetMemoryId: string | null;
  resultMemoryId: string | null;
  actor: CandidateActor;
  note: string | null;
  resolvedAt: string;
}

export interface CandidateResolutionResult {
  candidate: MemoryCandidate;
  resolution: CandidateResolution;
  memory: Memory | null;
  targetMemory: Memory | null;
}

export const candidateMatchKinds = [
  "exact_normalized",
  "semantic_duplicate",
  "semantic_refinement",
  "semantic_conflict",
  "semantic_related",
] as const;
export type CandidateMatchKind = (typeof candidateMatchKinds)[number];

export interface CandidateMatch {
  memory: Memory;
  matchKind: CandidateMatchKind;
  score: number;
  reason: string;
  matcherId: string;
  matcherVersion: string;
}

export interface CandidateSemanticMatchProposal {
  memoryId: string;
  matchKind: Exclude<CandidateMatchKind, "exact_normalized">;
  score: number;
  reason: string;
}

export interface CandidateSemanticMatchInput {
  candidate: MemoryCandidate;
  memories: Memory[];
}

export interface CandidateSemanticMatcher {
  readonly id: string;
  readonly version: string;
  match(input: CandidateSemanticMatchInput): CandidateSemanticMatchProposal[];
}
