import type { PersonaMemoryClass } from "./continuity-memory.js";
import type {
  CandidateEvidenceInput,
  ImportSourceInput,
  MemoryCandidate,
  Source,
  SourceRecord,
} from "./ingestion.js";
import type {
  Explicitness,
  MemoryType,
  RetrievalPolicy,
  Sensitivity,
} from "./memory.js";
import type { PersonaContext } from "./persona.js";

export interface AmbientMemoryProposal {
  assertion: string;
  type: MemoryType;
  memoryClass: PersonaMemoryClass;
  evidence: CandidateEvidenceInput[];
  normalizedAssertion?: string;
  explicitness?: Explicitness;
  confidence?: number;
  observedAt?: string;
  validFrom?: string;
  validTo?: string;
  reviewAfter?: string;
  retrievalPolicy?: RetrievalPolicy;
  sensitivity?: Sensitivity;
  isPinned?: boolean;
  isProtected?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AmbientExtractionInput {
  personaContext: PersonaContext;
  source: Source;
  records: SourceRecord[];
}

export interface AmbientMemoryExtractor {
  readonly id: string;
  readonly version: string;
  extract(
    input: AmbientExtractionInput,
  ): AmbientMemoryProposal[] | Promise<AmbientMemoryProposal[]>;
}

export interface AmbientExtractionProvider {
  readonly id: string;
  readonly version: string;
  extract(input: AmbientExtractionInput): unknown | Promise<unknown>;
}

export interface AmbientSensitivityAssessment {
  sensitivity: Sensitivity;
  confidence: number;
  reasonCodes: string[];
}

export interface AmbientSensitivityInput extends AmbientExtractionInput {
  proposal: AmbientMemoryProposal;
  evidenceRecords: SourceRecord[];
}

export interface AmbientSensitivityClassifier {
  readonly id: string;
  readonly version: string;
  classify(
    input: AmbientSensitivityInput,
  ): AmbientSensitivityAssessment | Promise<AmbientSensitivityAssessment>;
}

export interface CaptureAmbientInteractionInput {
  personaId: string;
  source: ImportSourceInput;
}

export interface AmbientCaptureResult {
  source: Source;
  candidates: MemoryCandidate[];
  createdCandidateCount: number;
}
