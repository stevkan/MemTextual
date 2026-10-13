import type {
  PersonaRankingProfile,
  RankingMutationContext,
  UpdatePersonaRankingProfileInput,
} from "../domain/continuity-ranking.js";
import type { ContinuityRankingRepository } from "../repositories/continuity-ranking-repository.js";

export class ExplicitRankingConfigurationRequiredError extends Error {
  public constructor() {
    super("Persona ranking changes require an explicit user action.");
    this.name = "ExplicitRankingConfigurationRequiredError";
  }
}

export class ContinuityRankingService {
  public constructor(private readonly repository: ContinuityRankingRepository) {}

  public getProfile(personaId: string): PersonaRankingProfile {
    return this.repository.getCurrentProfile(personaId);
  }

  public listProfileHistory(personaId: string): PersonaRankingProfile[] {
    return this.repository.listProfileHistory(personaId);
  }

  public updateProfile(
    input: UpdatePersonaRankingProfileInput,
    context: RankingMutationContext = {},
  ): PersonaRankingProfile {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitRankingConfigurationRequiredError();
    }
    return this.repository.appendProfile(input, "user");
  }
}
