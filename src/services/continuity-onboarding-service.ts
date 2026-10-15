import type {
  ContinuityUser,
  PersonaContext,
} from "../domain/persona.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";

export interface ContinuityOnboardingInput {
  userId?: string;
  userDisplayName?: string;
  personaId?: string;
  personaName?: string;
  personaDescription?: string;
  relationshipName?: string;
}

export interface ContinuityOnboardingResult {
  user: ContinuityUser;
  personaContext: PersonaContext;
  createdUser: boolean;
  createdPersona: boolean;
}

export interface ContinuityOnboardingUserStatus {
  user: ContinuityUser;
  personas: PersonaContext[];
}

function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return normalized;
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export class ContinuityOnboardingService {
  public constructor(private readonly repository: PersonaRepository) {}

  public status(): ContinuityOnboardingUserStatus[] {
    return this.repository.listUsers().map((user) => ({
      user,
      personas: this.repository.listPersonas(user.id),
    }));
  }

  public setup(input: ContinuityOnboardingInput): ContinuityOnboardingResult {
    const userId = optionalText(input.userId, "A user ID");
    const userDisplayName = optionalText(
      input.userDisplayName,
      "A user display name",
    );
    const personaId = optionalText(input.personaId, "A persona ID");
    const personaName = optionalText(input.personaName, "A persona name");
    const personaDescription = optionalText(
      input.personaDescription,
      "A persona description",
    );
    const relationshipName = optionalText(
      input.relationshipName,
      "A relationship name",
    );

    return this.repository.runInTransaction(() => {
      const userResolution = this.resolveUser(userId, userDisplayName);
      const personaResolution = this.resolvePersona(
        userResolution.user,
        personaId,
        personaName,
        personaDescription,
        relationshipName,
      );
      return {
        user: userResolution.user,
        personaContext: personaResolution.personaContext,
        createdUser: userResolution.created,
        createdPersona: personaResolution.created,
      };
    });
  }

  private resolveUser(
    userId: string | undefined,
    userDisplayName: string | undefined,
  ): { user: ContinuityUser; created: boolean } {
    if (userId !== undefined) {
      const user = this.repository.getUser(userId);
      if (user === null) {
        throw new Error(`Continuity user not found: ${userId}`);
      }
      if (
        userDisplayName !== undefined &&
        !sameText(user.displayName, userDisplayName)
      ) {
        throw new Error(
          `User ${userId} is named "${user.displayName}", not "${userDisplayName}".`,
        );
      }
      return { user, created: false };
    }

    const users = this.repository.listUsers();
    if (users.length === 0) {
      if (userDisplayName === undefined) {
        throw new Error(
          "--user-name is required when creating the first Continuity user.",
        );
      }
      return {
        user: this.repository.createUser({ displayName: userDisplayName }),
        created: true,
      };
    }

    if (userDisplayName !== undefined) {
      const matching = users.filter((user) =>
        sameText(user.displayName, userDisplayName),
      );
      if (matching.length === 1) {
        return { user: matching[0]!, created: false };
      }
      if (matching.length > 1) {
        throw new Error(
          `More than one Continuity user is named "${userDisplayName}"; select one with --user-id.`,
        );
      }
      throw new Error(
        "A Continuity user already exists. Run status and select it with --user-id; setup will not silently create another user.",
      );
    }

    if (users.length === 1) {
      return { user: users[0]!, created: false };
    }
    throw new Error(
      "More than one Continuity user exists; run status and select one with --user-id.",
    );
  }

  private resolvePersona(
    user: ContinuityUser,
    personaId: string | undefined,
    personaName: string | undefined,
    personaDescription: string | undefined,
    relationshipName: string | undefined,
  ): { personaContext: PersonaContext; created: boolean } {
    if (personaId !== undefined) {
      const personaContext = this.repository.getPersonaContext(personaId);
      if (personaContext === null) {
        throw new Error(`Persona not found: ${personaId}`);
      }
      if (personaContext.persona.userId !== user.id) {
        throw new Error(`Persona ${personaId} does not belong to user ${user.id}.`);
      }
      this.requireExistingPersonaMatches(
        personaContext,
        personaName,
        personaDescription,
        relationshipName,
      );
      return { personaContext, created: false };
    }

    if (personaName === undefined) {
      throw new Error(
        "--persona-name is required unless an existing --persona-id is selected.",
      );
    }
    const existing = this.repository
      .listPersonas(user.id)
      .find(({ persona }) => sameText(persona.name, personaName));
    if (existing !== undefined) {
      this.requireExistingPersonaMatches(
        existing,
        personaName,
        personaDescription,
        relationshipName,
      );
      return { personaContext: existing, created: false };
    }

    return {
      personaContext: this.repository.createPersona({
        userId: user.id,
        name: personaName,
        ...(personaDescription === undefined
          ? {}
          : { description: personaDescription }),
        ...(relationshipName === undefined ? {} : { relationshipName }),
      }),
      created: true,
    };
  }

  private requireExistingPersonaMatches(
    context: PersonaContext,
    personaName: string | undefined,
    personaDescription: string | undefined,
    relationshipName: string | undefined,
  ): void {
    if (
      personaName !== undefined &&
      !sameText(context.persona.name, personaName)
    ) {
      throw new Error(
        `Persona ${context.persona.id} is named "${context.persona.name}", not "${personaName}".`,
      );
    }
    if (
      personaDescription !== undefined &&
      context.persona.description !== personaDescription
    ) {
      throw new Error(
        "The existing persona has a different description; setup will not overwrite it.",
      );
    }
    if (
      relationshipName !== undefined &&
      context.relationship.name !== relationshipName
    ) {
      throw new Error(
        "The existing persona has a different relationship name; setup will not overwrite it.",
      );
    }
  }
}
