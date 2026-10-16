import type {
  ConfigurePersonaBehaviorProfileInput,
  PersonaBehaviorMutationContext,
  PersonaBehaviorProfile,
} from "../domain/continuity-persona-behavior.js";
import type { ContinuityPersonaBehaviorRepository } from "../repositories/continuity-persona-behavior-repository.js";

export class ExplicitPersonaBehaviorConfigurationRequiredError extends Error {
  public constructor() {
    super("Persona behavior changes require an explicit user action.");
    this.name = "ExplicitPersonaBehaviorConfigurationRequiredError";
  }
}

export class ContinuityPersonaBehaviorService {
  public constructor(
    private readonly repository: ContinuityPersonaBehaviorRepository,
  ) {}

  public getProfile(personaId: string): PersonaBehaviorProfile | null {
    return this.repository.getCurrentProfile(personaId);
  }

  public listProfileHistory(personaId: string): PersonaBehaviorProfile[] {
    return this.repository.listProfileHistory(personaId);
  }

  public configureProfile(
    input: ConfigurePersonaBehaviorProfileInput,
    context: PersonaBehaviorMutationContext = {},
  ): PersonaBehaviorProfile {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitPersonaBehaviorConfigurationRequiredError();
    }
    return this.repository.appendProfile(input, "user");
  }
}

