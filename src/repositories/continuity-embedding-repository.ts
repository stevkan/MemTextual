import type {
  ContinuityEmbeddingSource,
  ContinuityHybridRetrievalQuery,
  ContinuityQueryEmbedding,
  PersonaMemoryHybridRetrievalResult,
  StoreContinuityEmbeddingInput,
  StoredContinuityEmbedding,
} from "../domain/continuity-embedding.js";

export interface ContinuityEmbeddingRepository {
  preflightHybridRetrieval(query: ContinuityHybridRetrievalQuery): boolean;
  getEmbeddingSource(
    personaId: string,
    memoryId: string,
  ): ContinuityEmbeddingSource;
  storeEmbedding(
    input: StoreContinuityEmbeddingInput,
  ): StoredContinuityEmbedding;
  retrieveHybrid(
    query: ContinuityHybridRetrievalQuery,
    queryEmbedding: ContinuityQueryEmbedding,
  ): PersonaMemoryHybridRetrievalResult[];
}
