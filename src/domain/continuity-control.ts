import type { PersonaMemory, PersonaMemoryClass } from "./continuity-memory.js";
import type {
  CandidateEvidence,
  CandidateMatch,
  CandidateResolutionInput,
  CandidateStatus,
  MemoryCandidate,
  SourceRecord,
} from "./ingestion.js";
import type {
  DeleteMemoryInput,
  MemoryRevision,
  PurgeMemoryInput,
  ReviseMemoryInput,
} from "./memory.js";

export interface ContinuityControlMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
  note?: string;
}

export interface ContinuityCandidateQueueItem {
  candidate: MemoryCandidate;
  memoryClass: PersonaMemoryClass;
}

export interface ContinuityCandidateEvidenceView {
  evidence: CandidateEvidence;
  record: SourceRecord | null;
}

export interface ContinuityCandidateReview {
  candidate: MemoryCandidate;
  memoryClass: PersonaMemoryClass;
  evidence: ContinuityCandidateEvidenceView[];
  matches: CandidateMatch[];
}

export interface ContinuityMemoryDetail {
  personaMemory: PersonaMemory;
  history: MemoryRevision[];
}

export interface ContinuityCandidateQueueQuery {
  personaId: string;
  status?: CandidateStatus;
  limit?: number;
}

export interface ContinuityCandidateResolutionRequest {
  personaId: string;
  candidateId: string;
  resolution: CandidateResolutionInput;
}

export interface ContinuityMemoryRevisionRequest {
  personaId: string;
  memoryId: string;
  revision: ReviseMemoryInput;
}

export interface ContinuityMemoryDeletionRequest {
  personaId: string;
  memoryId: string;
  deletion: DeleteMemoryInput;
}

export interface ContinuityMemoryPurgeRequest {
  personaId: string;
  memoryId: string;
  purge: PurgeMemoryInput;
}
