import type {
  ConfigurePersonaBehaviorProfileInput,
  PersonaBehaviorProfile,
} from "../domain/continuity-persona-behavior.js";

export interface ContinuityPersonaBehaviorRepository {
  getCurrentProfile(personaId: string): PersonaBehaviorProfile | null;
  listProfileHistory(personaId: string): PersonaBehaviorProfile[];
  appendProfile(
    input: ConfigurePersonaBehaviorProfileInput,
    actor: "user",
  ): PersonaBehaviorProfile;
}

