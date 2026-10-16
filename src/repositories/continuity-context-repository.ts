import type { ContinuityContextRetrievalAudit } from "../domain/continuity-embedding.js";
import type {
  ContinuityRetrievalQuery,
  PersonaMemoryRetrievalResult,
} from "../domain/continuity-memory.js";

export interface ContinuityContextRetrievalSelection<T> {
  results: readonly PersonaMemoryRetrievalResult[];
  value: T;
  contextComposition?: ContinuityContextRetrievalAudit;
}

export interface ContinuityContextRepository {
  retrieveContextSelection<T>(
    query: ContinuityRetrievalQuery,
    select: (
      ranked: readonly PersonaMemoryRetrievalResult[],
    ) => ContinuityContextRetrievalSelection<T>,
  ): T;
}
