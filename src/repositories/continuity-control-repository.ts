import type { PersonaMemoryClass } from "../domain/continuity-memory.js";
import type { CandidateStatus } from "../domain/ingestion.js";

export interface ContinuityCandidateBinding {
  candidateId: string;
  userId: string;
  personaId: string;
  relationshipId: string;
  memoryClass: PersonaMemoryClass;
}

export interface ContinuityControlRepository {
  getCandidateBinding(candidateId: string): ContinuityCandidateBinding | null;
  listCandidateBindings(
    personaId: string,
    status?: CandidateStatus,
    limit?: number,
  ): ContinuityCandidateBinding[];
}
