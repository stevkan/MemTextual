import type { CreateMemoryInput, Memory, Sensitivity } from "./memory.js";

export const personaMemoryClasses = ["episodic", "durable"] as const;

export type PersonaMemoryClass = (typeof personaMemoryClasses)[number];

export interface CreatePersonaMemoryInput
  extends Omit<CreateMemoryInput, "scopeId"> {
  personaId: string;
  memoryClass: PersonaMemoryClass;
}

export interface PersonaMemory {
  memory: Memory;
  userId: string;
  personaId: string;
  relationshipId: string;
  memoryClass: PersonaMemoryClass;
  createdAt: string;
  updatedAt: string;
}

export interface ContinuityRetrievalQuery {
  personaId: string;
  text: string;
  memoryClasses?: PersonaMemoryClass[];
  allowedSensitivities?: Sensitivity[];
  limit?: number;
}

export interface PersonaMemoryRetrievalResult {
  personaMemory: PersonaMemory;
  rank: number;
}
