import type {
  ContinuityUser,
  CreateContinuityUserInput,
  CreatePersonaInput,
  PersonaContext,
  UpdatePersonaInput,
} from "../domain/persona.js";

export interface PersonaRepository {
  runInTransaction<T>(operation: () => T): T;
  createUser(input: CreateContinuityUserInput): ContinuityUser;
  getUser(id: string): ContinuityUser | null;
  listUsers(): ContinuityUser[];
  createPersona(input: CreatePersonaInput): PersonaContext;
  updatePersona(input: UpdatePersonaInput): PersonaContext;
  getPersonaContext(id: string): PersonaContext | null;
  listPersonas(userId: string): PersonaContext[];
}
