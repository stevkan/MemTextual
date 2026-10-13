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
