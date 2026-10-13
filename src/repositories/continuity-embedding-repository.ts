import type {
  ContinuityEmbeddingSource,
  ContinuityContextRetrievalAudit,
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
  recordHybridRetrieval(
    query: ContinuityHybridRetrievalQuery,
    queryEmbedding: ContinuityQueryEmbedding,
    results: readonly PersonaMemoryHybridRetrievalResult[],
    contextComposition?: ContinuityContextRetrievalAudit,
  ): void;
}
