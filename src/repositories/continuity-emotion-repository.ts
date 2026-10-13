import type {
  AnnotatePersonaMemoryEmotionInput,
  PersonaMemoryEmotionProfile,
} from "../domain/continuity-emotion.js";

export interface ContinuityEmotionRepository {
  getCurrentEmotionProfile(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile | null;
  listEmotionProfileHistory(
    personaId: string,
    memoryId: string,
  ): PersonaMemoryEmotionProfile[];
  appendEmotionProfile(
    input: AnnotatePersonaMemoryEmotionInput,
  ): PersonaMemoryEmotionProfile;
}
