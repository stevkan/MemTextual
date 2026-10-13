import type {
  Explicitness,
  MemoryType,
  RetrievalPolicy,
  Sensitivity,
} from "./memory.js";

export interface LegacyMemorySource {
  title: string;
  originSystem: string;
  externalId: string;
  originUri?: string;
  exportedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface LegacyMemoryEntry {
  id: string;
  assertion: string;
  type?: MemoryType;
  scopeId?: string;
  normalizedAssertion?: string;
  explicitness?: Explicitness;
  confidence?: number;
  observedAt?: string;
  createdAt?: string;
  retrievalPolicy?: RetrievalPolicy;
  sensitivity?: Sensitivity;
  isPinned?: boolean;
  isProtected?: boolean;
  authorRole?: string;
  authorName?: string;
  metadata?: Record<string, unknown>;
}

export interface LegacyMemoryExport {
  formatVersion: 1;
  source: LegacyMemorySource;
  memories: LegacyMemoryEntry[];
}

export interface LegacyMemoryMigrationOptions {
  defaultScopeId?: string;
}

export interface LegacyMemoryMigrationItemResult {
  legacyMemoryId: string;
  candidateId: string;
  candidateExternalId: string;
  status: "pending" | "accepted" | "rejected";
  created: boolean;
}

export interface LegacyMemoryMigrationResult {
  sourceId: string;
  sourceExternalId: string;
  sourceCreated: boolean;
  items: LegacyMemoryMigrationItemResult[];
  summary: {
    created: number;
    reused: number;
    pending: number;
    accepted: number;
    rejected: number;
  };
}
