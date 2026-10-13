import type {
  AnnotatePersonaMemoryEmotionInput,
  EmotionAnnotationMutationContext,
  PersonaMemoryEmotionProfile,
} from "../domain/continuity-emotion.js";
import type { ContinuityEmotionRepository } from "../repositories/continuity-emotion-repository.js";

export class ExplicitEmotionAnnotationRequiredError extends Error {
  public constructor() {
    super("Emotional annotations require an explicit user action.");
    this.name = "ExplicitEmotionAnnotationRequiredError";
  }
}

export class ContinuityEmotionService {
  public constructor(private readonly repository: ContinuityEmotionRepository) {}

  public getProfile(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile | null {
    return this.repository.getCurrentEmotionProfile(personaId, memoryId);
  }

  public listHistory(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile[] {
    return this.repository.listEmotionProfileHistory(personaId, memoryId);
  }

  public annotate(
    input: AnnotatePersonaMemoryEmotionInput,
    context: EmotionAnnotationMutationContext = {},
  ): PersonaMemoryEmotionProfile {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitEmotionAnnotationRequiredError();
    }
    return this.repository.appendEmotionProfile(input);
  }
}
