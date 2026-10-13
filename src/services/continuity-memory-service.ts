import type {
  CreatePersonaMemoryInput,
  PersonaMemory,
  PersonaMemoryClass,
} from "../domain/continuity-memory.js";
import type { ContinuityMemoryRepository } from "../repositories/continuity-memory-repository.js";

export class ContinuityMemoryService {
  public constructor(private readonly repository: ContinuityMemoryRepository) {}

  public create(input: CreatePersonaMemoryInput): PersonaMemory {
    return this.repository.create(input);
  }

  public getById(memoryId: string): PersonaMemory | null {
    return this.repository.getById(memoryId);
  }

  public listForPersona(
    personaId: string,
    memoryClass?: PersonaMemoryClass,
  ): PersonaMemory[] {
    return this.repository.listForPersona(personaId, memoryClass);
  }
}
