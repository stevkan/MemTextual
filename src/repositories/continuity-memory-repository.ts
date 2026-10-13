import type {
  ContinuityRetrievalQuery,
  CreatePersonaMemoryInput,
  PersonaMemory,
  PersonaMemoryClass,
  PersonaMemoryRetrievalResult,
} from "../domain/continuity-memory.js";

export interface ContinuityMemoryRepository {
  create(input: CreatePersonaMemoryInput): PersonaMemory;
  getById(memoryId: string): PersonaMemory | null;
  listForPersona(
    personaId: string,
    memoryClass?: PersonaMemoryClass,
  ): PersonaMemory[];
  retrieve(query: ContinuityRetrievalQuery): PersonaMemoryRetrievalResult[];
}
