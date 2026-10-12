export const memoryTypes = [
  "preference",
  "fact",
  "decision",
  "entity",
  "task_context",
  "instruction",
  "goal",
  "relationship",
  "other",
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export const memoryStatuses = [
  "active",
  "superseded",
  "contradicted",
  "archived",
  "deleted",
] as const;

export type MemoryStatus = (typeof memoryStatuses)[number];
export type RetrievalPolicy = "include" | "exclude" | "manual";
export type Sensitivity = "normal" | "sensitive" | "restricted";
export type Explicitness = "explicit" | "inferred";
export type MemoryActor = "user" | "extractor" | "system" | "import";
export type MemoryChangeKind =
  | "created"
  | "edited"
  | "reaffirmed"
  | "corrected"
  | "superseded";

export type ScopeKind = "global" | "project" | "conversation" | "namespace";

export interface Scope {
  id: string;
  kind: ScopeKind;
  name: string;
  externalKey: string | null;
  parentScopeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScopeInput {
  kind: ScopeKind;
  name: string;
  externalKey?: string;
  parentScopeId?: string;
}

export interface MemoryScope {
  id: string;
  kind: ScopeKind;
  name: string;
  isPrimary: boolean;
}

export interface Memory {
  id: string;
  type: MemoryType;
  status: MemoryStatus;
  retrievalPolicy: RetrievalPolicy;
  sensitivity: Sensitivity;
  isPinned: boolean;
  isProtected: boolean;
  revisionId: string;
  revisionNumber: number;
  assertion: string;
  normalizedAssertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  observedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scopes: MemoryScope[];
}

export interface CreateMemoryInput {
  assertion: string;
  type: MemoryType;
  scopeId: string;
  sourceRecordId?: string;
  normalizedAssertion?: string;
  explicitness?: Explicitness;
  confidence?: number;
  observedAt?: string;
  createdBy?: MemoryActor;
  retrievalPolicy?: RetrievalPolicy;
  sensitivity?: Sensitivity;
  isPinned?: boolean;
  isProtected?: boolean;
}

export interface MemoryRevision {
  id: string;
  memoryId: string;
  revisionNumber: number;
  assertion: string;
  normalizedAssertion: string | null;
  explicitness: Explicitness;
  confidence: number;
  changeKind: MemoryChangeKind;
  previousRevisionId: string | null;
  observedAt: string | null;
  createdBy: MemoryActor;
  createdAt: string;
}

export interface ReviseMemoryInput {
  assertion: string;
  normalizedAssertion?: string | null;
  explicitness?: Explicitness;
  confidence?: number;
  observedAt?: string | null;
  sourceRecordId?: string;
  changeKind?: Exclude<MemoryChangeKind, "created" | "superseded">;
}

export interface MemoryMutationContext {
  actor?: MemoryActor;
  explicitUserAction?: boolean;
}

export interface RetrievalQuery {
  text: string;
  scopeIds: string[];
  allowedSensitivities?: Sensitivity[];
  limit?: number;
}

export interface RetrievalResult {
  memory: Memory;
  rank: number;
}
