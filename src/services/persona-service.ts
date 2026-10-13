import type {
  ContinuityUser,
  CreateContinuityUserInput,
  CreatePersonaInput,
  PersonaContext,
} from "../domain/persona.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";

export class PersonaService {
  public constructor(private readonly repository: PersonaRepository) {}

  public createUser(input: CreateContinuityUserInput): ContinuityUser {
    return this.repository.createUser(input);
  }

  public getUser(id: string): ContinuityUser | null {
    return this.repository.getUser(id);
  }

  public listUsers(): ContinuityUser[] {
    return this.repository.listUsers();
  }

  public createPersona(input: CreatePersonaInput): PersonaContext {
    return this.repository.createPersona(input);
  }

  public getPersonaContext(id: string): PersonaContext | null {
    return this.repository.getPersonaContext(id);
  }

  public listPersonas(userId: string): PersonaContext[] {
    return this.repository.listPersonas(userId);
  }
}
