import type { ContinuityHybridRetrievalQuery } from "./continuity-embedding.js";
import type {
  MemoryType,
  Sensitivity,
  TemporalStatus,
} from "./memory.js";
import type { PersonaMemoryClass } from "./continuity-memory.js";

export const continuityContextFormat = "memtextual-continuity-context" as const;
export const continuityContextFormatVersion = 1 as const;
export const defaultContinuityContextMaxItems = 10;
export const defaultContinuityContextMaxUtf8Bytes = 8_192;
export const maximumContinuityContextMaxItems = 100;
export const maximumContinuityContextMaxUtf8Bytes = 1_048_576;

export interface ContinuityContextLimits {
  maxItems?: number;
  maxUtf8Bytes?: number;
  maxEpisodicItems?: number;
  maxDurableItems?: number;
}

export interface ContinuityContextQuery
  extends ContinuityHybridRetrievalQuery {
  contextLimits?: ContinuityContextLimits;
}

export interface ContinuityContextItem {
  rank: number;
  memoryId: string;
  revisionId: string;
  memoryClass: PersonaMemoryClass;
  type: MemoryType;
  sensitivity: Sensitivity;
  assertion: string;
  temporalStatus: TemporalStatus;
  reviewDue: boolean;
}

export interface ContinuityContextPayload {
  format: typeof continuityContextFormat;
  formatVersion: typeof continuityContextFormatVersion;
  contentRole: "memory_data";
  personaId: string;
  items: ContinuityContextItem[];
}

export interface ContinuityContextOmissionCounts {
  itemLimit: number;
  byteLimit: number;
  classLimit: number;
}

export interface ContinuityContextComposition {
  payload: ContinuityContextPayload;
  contextJson: string;
  utf8Bytes: number;
  limits: Required<ContinuityContextLimits>;
  consideredCount: number;
  omittedCount: number;
  omissionCounts: ContinuityContextOmissionCounts;
}
