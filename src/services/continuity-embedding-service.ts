import { createHash } from "node:crypto";
import type {
  ContinuityEmbeddingProvider,
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
    if (query.text.trim().length === 0) {
      return [];
    }
    if (!this.repository.preflightHybridRetrieval(query)) {
      return [];
    }
    const vector = validateVector(
      await this.provider.embed({ text: query.text, purpose: "query" }),
      this.identity.dimensions,
    );
    return this.repository.retrieveHybrid(query, {
      ...this.identity,
      vector,
    });
  }
}
