export type PersonaMetadata = Record<string, unknown>;

export interface ContinuityUser {
  id: string;
  displayName: string;
  externalId: string | null;
  scopeId: string;
  metadata: PersonaMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContinuityUserInput {
  displayName: string;
  externalId?: string;
  metadata?: PersonaMetadata;
}

export interface Persona {
  id: string;
  userId: string;
  name: string;
  externalId: string | null;
  description: string | null;
  scopeId: string;
  metadata: PersonaMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaRelationship {
  id: string;
  userId: string;
  personaId: string;
  name: string;
  scopeId: string;
  metadata: PersonaMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonaInput {
  userId: string;
  name: string;
  externalId?: string;
  description?: string;
  relationshipName?: string;
  personaMetadata?: PersonaMetadata;
  relationshipMetadata?: PersonaMetadata;
}

export interface PersonaContext {
  persona: Persona;
  relationship: PersonaRelationship;
}
