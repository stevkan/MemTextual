import type { CreateMemoryInput, Memory } from "./memory.js";

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
