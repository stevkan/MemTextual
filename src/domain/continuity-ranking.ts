import type { PersonaMemoryClass } from "./continuity-memory.js";

export interface PersonaRankingProfile {
  id: string;
  personaId: string;
  revisionNumber: number;
  lexicalWeight: number;
  semanticWeight: number;
  pinnedBoost: number;
  explicitBoost: number;
  episodicBoost: number;
  durableBoost: number;
  emotionalWeight: number;
  createdBy: "user" | "system";
  note: string | null;
  createdAt: string;
}

export interface UpdatePersonaRankingProfileInput {
  personaId: string;
  expectedRevisionNumber: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  pinnedBoost?: number;
  explicitBoost?: number;
  episodicBoost?: number;
  durableBoost?: number;
  emotionalWeight?: number;
  note?: string;
}

export interface RankingMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
}

export interface PersonaRankingSignals {
  pinned: boolean;
  explicit: boolean;
  memoryClass: PersonaMemoryClass;
}
