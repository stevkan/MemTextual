export interface EmotionalContext {
  valence: number;
  activation: number;
  salience: number;
}

export interface PersonaMemoryEmotionProfile extends EmotionalContext {
  id: string;
  personaId: string;
  memoryId: string;
  memoryRevisionId: string;
  revisionNumber: number;
  createdBy: "user";
  note: string | null;
  createdAt: string;
}

export interface AnnotatePersonaMemoryEmotionInput extends EmotionalContext {
  personaId: string;
  memoryId: string;
  expectedProfileRevision: number;
  note?: string;
}

export interface EmotionAnnotationMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
}
