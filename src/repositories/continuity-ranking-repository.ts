import type {
  PersonaRankingProfile,
  UpdatePersonaRankingProfileInput,
} from "../domain/continuity-ranking.js";

export interface ContinuityRankingRepository {
  getCurrentProfile(personaId: string): PersonaRankingProfile;
  listProfileHistory(personaId: string): PersonaRankingProfile[];
  appendProfile(
    input: UpdatePersonaRankingProfileInput,
    actor: "user" | "system",
  ): PersonaRankingProfile;
}
