import type {
  ContinuityUser,
  PersonaContext,
  UpdatePersonaInput,
} from "../domain/persona.js";
import type { PersonaService } from "./persona-service.js";

export interface ContinuityAuthenticatedPrincipal {
  authenticationSubject: string;
  continuityUserId: string;
}

export interface CreateAuthenticatedPersonaInput {
  name: string;
  description?: string;
  relationshipName?: string;
}

export type UpdateAuthenticatedPersonaInput = Omit<UpdatePersonaInput, "id"> & {
  personaId: string;
};

export class ContinuityAuthenticatedPersonaService {
  public constructor(private readonly personas: PersonaService) {}

  public getProfile(principal: ContinuityAuthenticatedPrincipal): ContinuityUser {
    return this.requireUser(principal);
  }

  public listPersonas(
    principal: ContinuityAuthenticatedPrincipal,
  ): PersonaContext[] {
    const user = this.requireUser(principal);
    return this.personas.listPersonas(user.id);
  }

  public getPersona(
    principal: ContinuityAuthenticatedPrincipal,
    personaId: string,
  ): PersonaContext {
    const user = this.requireUser(principal);
    return this.requireOwnedPersona(user.id, personaId);
  }

  public createPersona(
    principal: ContinuityAuthenticatedPrincipal,
    input: CreateAuthenticatedPersonaInput,
  ): PersonaContext {
    const user = this.requireUser(principal);
    return this.personas.createPersona({
      userId: user.id,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.relationshipName === undefined
        ? {}
        : { relationshipName: input.relationshipName }),
    });
  }

  public updatePersona(
    principal: ContinuityAuthenticatedPrincipal,
    input: UpdateAuthenticatedPersonaInput,
  ): PersonaContext {
    const user = this.requireUser(principal);
    this.requireOwnedPersona(user.id, input.personaId);
    return this.personas.updatePersona({
      id: input.personaId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.relationshipName === undefined
        ? {}
        : { relationshipName: input.relationshipName }),
    });
  }

  private requireUser(
    principal: ContinuityAuthenticatedPrincipal,
  ): ContinuityUser {
    if (principal.authenticationSubject.trim().length === 0) {
      throw new Error("An authenticated Continuity subject is required.");
    }
    const user = this.personas.getUser(principal.continuityUserId);
    if (user === null) {
      throw new Error("Authenticated Continuity user not found.");
    }
    return user;
  }

  private requireOwnedPersona(userId: string, personaId: string): PersonaContext {
    const persona = this.personas.getPersonaContext(personaId);
    if (persona === null || persona.persona.userId !== userId) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    return persona;
  }
}
