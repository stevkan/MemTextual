export interface PersonaBehaviorProfile {
  id: string;
  personaId: string;
  revisionNumber: number;
  instructions: string;
  enabled: boolean;
  createdBy: "user";
  note: string | null;
  createdAt: string;
}

export interface ConfigurePersonaBehaviorProfileInput {
  personaId: string;
  expectedRevisionNumber: number | null;
  instructions: string;
  enabled: boolean;
  note?: string;
}

export interface PersonaBehaviorMutationContext {
  actor?: "user" | "system";
  explicitUserAction?: boolean;
}

