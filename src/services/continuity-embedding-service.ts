import { createHash } from "node:crypto";
import type {
  ContinuityEmbeddingProvider,
  ContinuityContextRetrievalAudit,
  ContinuityHybridRetrievalQuery,
  EmbeddingProviderIdentity,
  PersonaMemoryHybridRetrievalResult,
  StoredContinuityEmbedding,
} from "../domain/continuity-embedding.js";
import type { ContinuityEmbeddingRepository } from "../repositories/continuity-embedding-repository.js";

function validateIdentity(
  identity: EmbeddingProviderIdentity,
): EmbeddingProviderIdentity {
  const provider = identity.provider.trim();
  const model = identity.model.trim();
  if (provider.length === 0 || model.length === 0) {
    throw new Error("Embedding provider and model identifiers must not be empty.");
  }
  if (!Number.isSafeInteger(identity.dimensions) || identity.dimensions <= 0) {
    throw new Error("Embedding dimensions must be a positive safe integer.");
  }
  return { provider, model, dimensions: identity.dimensions };
}

function validateVector(
  vector: readonly number[],
  dimensions: number,
): readonly number[] {
  if (vector.length !== dimensions) {
    throw new Error(
      `Embedding provider returned ${vector.length} dimensions; expected ${dimensions}.`,
    );
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding vectors may contain only finite numbers.");
  }
  if (vector.every((value) => value === 0)) {
    throw new Error("Embedding vectors must have a non-zero magnitude.");
  }
  return vector;
}

function validateSelection(
  ranked: readonly PersonaMemoryHybridRetrievalResult[],
  selected: readonly PersonaMemoryHybridRetrievalResult[],
): void {
  const available = new Set(ranked);
  const selectedMemoryIds = new Set<string>();
  for (const result of selected) {
    if (!available.has(result)) {
      throw new Error("A retrieval selection must use ranked result objects.");
    }
    const memoryId = result.personaMemory.memory.id;
    if (selectedMemoryIds.has(memoryId)) {
      throw new Error("A retrieval selection may not contain duplicates.");
    }
    selectedMemoryIds.add(memoryId);
  }
}

export class ContinuityEmbeddingService {
  private readonly identity: EmbeddingProviderIdentity;

  public constructor(
    private readonly repository: ContinuityEmbeddingRepository,
    private readonly provider: ContinuityEmbeddingProvider,
  ) {
    this.identity = validateIdentity(provider.identity);
  }

  public async indexMemory(
    personaId: string,
    memoryId: string,
  ): Promise<StoredContinuityEmbedding> {
    const source = this.repository.getEmbeddingSource(personaId, memoryId);
    const vector = validateVector(
      await this.provider.embed({ text: source.text, purpose: "document" }),
      this.identity.dimensions,
    );
    return this.repository.storeEmbedding({
      ...source,
      ...this.identity,
      vector,
      contentHash: createHash("sha256")
        .update(source.text, "utf8")
        .digest("hex"),
    });
  }

  public async retrieve(
    query: ContinuityHybridRetrievalQuery,
  ): Promise<PersonaMemoryHybridRetrievalResult[]> {
    return this.retrieveSelection(query, (ranked) => {
      const results = [...ranked];
      return { results, value: results };
    });
  }

  public async retrieveSelection<T>(
    query: ContinuityHybridRetrievalQuery,
    select: (
      ranked: readonly PersonaMemoryHybridRetrievalResult[],
    ) => {
      results: readonly PersonaMemoryHybridRetrievalResult[];
      value: T;
      contextComposition?: ContinuityContextRetrievalAudit;
    },
  ): Promise<T> {
    if (query.text.trim().length === 0) {
      const selection = select([]);
      validateSelection([], selection.results);
      return selection.value;
    }
    if (!this.repository.preflightHybridRetrieval(query)) {
      const selection = select([]);
      validateSelection([], selection.results);
      return selection.value;
    }
    const vector = validateVector(
      await this.provider.embed({ text: query.text, purpose: "query" }),
      this.identity.dimensions,
    );
    const queryEmbedding = {
      ...this.identity,
      vector,
    };
    const ranked = this.repository.retrieveHybrid(query, queryEmbedding);
    const selection = select(ranked);
    validateSelection(ranked, selection.results);
    this.repository.recordHybridRetrieval(
      query,
      queryEmbedding,
      selection.results,
      selection.contextComposition,
    );
    return selection.value;
  }
}
