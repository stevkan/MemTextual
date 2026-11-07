import type { PersonaMemory, PersonaMemoryClass } from "./continuity-memory.js";
import type {
  CandidateEvidence,
  CandidateMatch,
  CandidateResolutionInput,
  CandidateStatus,
  MemoryCandidate,
  Source,
  SourceRecord,
} from "./ingestion.js";
import type {
  DeleteMemoryInput,
  MemoryRevision,
  PurgeMemoryInput,
  ReviseMemoryInput,
} from "./memory.js";
import type { PersonaContext } from "./persona.js";

export const continuityPersonaMemoryExportFormat =
  "memtextual-continuity-persona-memories" as const;

export interface ContinuityControlMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
  note?: string;
}

export interface ContinuityCandidateQueueItem {
  candidate: MemoryCandidate;
  memoryClass: PersonaMemoryClass;
  provenance: ContinuityCandidateProvenance[];
}

export interface ContinuityCandidateProvenance {
  sourceId: string;
  sourceTitle: string;
  sourceKind: Source["kind"];
  sourceCapturedAt: string | null;
  sourceCreatedAt: string;
  recordOccurredAt: string | null;
  conversationId: string | null;
  turnId: string | null;
}

export interface ContinuityCandidateEvidenceView {
  evidence: CandidateEvidence;
  record: SourceRecord | null;
  provenance: ContinuityCandidateProvenance | null;
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

export interface ContinuityPersonaMemoryExport {
  format: typeof continuityPersonaMemoryExportFormat;
  formatVersion: 1;
  exportedAt: string;
  personaContext: PersonaContext;
  memories: ContinuityMemoryDetail[];
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
