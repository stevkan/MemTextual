import type {
  ContinuityRetrievalQuery,
  PersonaMemoryRetrievalResult,
} from "./continuity-memory.js";
import type { PersonaRankingSignals } from "./continuity-ranking.js";

export type EmbeddingPurpose = "document" | "query";

export interface EmbeddingProviderIdentity {
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingRequest {
  text: string;
  purpose: EmbeddingPurpose;
}

export interface ContinuityEmbeddingProvider {
  readonly identity: EmbeddingProviderIdentity;
  embed(request: EmbeddingRequest): Promise<readonly number[]>;
}

export interface ContinuityEmbeddingSource {
  memoryId: string;
  revisionId: string;
  text: string;
}

export interface StoreContinuityEmbeddingInput
  extends ContinuityEmbeddingSource,
    EmbeddingProviderIdentity {
  vector: readonly number[];
  contentHash: string;
}

export interface StoredContinuityEmbedding {
  id: string;
  memoryId: string;
  revisionId: string;
  provider: string;
  model: string;
  dimensions: number;
  contentHash: string;
  createdAt: string;
}

export interface ContinuityHybridRetrievalQuery
  extends ContinuityRetrievalQuery {
  candidateLimit?: number;
}

export interface ContinuityQueryEmbedding
  extends EmbeddingProviderIdentity {
  vector: readonly number[];
}

export interface PersonaMemoryHybridRetrievalResult
  extends PersonaMemoryRetrievalResult {
  lexicalScore: number;
  semanticScore: number | null;
  rankingBoost: number;
  rankingProfileRevision: number;
  rankingSignals: PersonaRankingSignals;
  combinedScore: number;
}
