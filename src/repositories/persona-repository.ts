import type {
  ContinuityUser,
  CreateContinuityUserInput,
  CreatePersonaInput,
  PersonaContext,
} from "../domain/persona.js";

export interface PersonaRepository {
  createUser(input: CreateContinuityUserInput): ContinuityUser;
  getUser(id: string): ContinuityUser | null;
  listUsers(): ContinuityUser[];
  createPersona(input: CreatePersonaInput): PersonaContext;
  getPersonaContext(id: string): PersonaContext | null;
  listPersonas(userId: string): PersonaContext[];
}
