import {
  continuityContextFormat,
  continuityContextFormatVersion,
  defaultContinuityContextMaxItems,
  defaultContinuityContextMaxUtf8Bytes,
  maximumContinuityContextMaxItems,
  maximumContinuityContextMaxUtf8Bytes,
  type ContinuityContextComposition,
  type ContinuityContextItem,
  type ContinuityContextLimits,
  type ContinuityContextOmissionCounts,
  type ContinuityContextPayload,
  type ContinuityContextQuery,
} from "../domain/continuity-context.js";
import type { PersonaMemoryHybridRetrievalResult } from "../domain/continuity-embedding.js";
import type { PersonaMemoryClass } from "../domain/continuity-memory.js";
import { ContinuityEmbeddingService } from "./continuity-embedding-service.js";

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function normalizeLimits(
  input: ContinuityContextLimits | undefined,
): Required<ContinuityContextLimits> {
  const maxItems = boundedInteger(
    input?.maxItems ?? defaultContinuityContextMaxItems,
    "maxItems",
    1,
    maximumContinuityContextMaxItems,
  );
  return {
    maxItems,
    maxUtf8Bytes: boundedInteger(
      input?.maxUtf8Bytes ?? defaultContinuityContextMaxUtf8Bytes,
      "maxUtf8Bytes",
      1,
      maximumContinuityContextMaxUtf8Bytes,
    ),
    maxEpisodicItems: boundedInteger(
      input?.maxEpisodicItems ?? maxItems,
      "maxEpisodicItems",
      0,
      maxItems,
    ),
    maxDurableItems: boundedInteger(
      input?.maxDurableItems ?? maxItems,
      "maxDurableItems",
      0,
      maxItems,
    ),
  };
}

function createPayload(
  personaId: string,
  items: ContinuityContextItem[],
): ContinuityContextPayload {
  return {
    format: continuityContextFormat,
    formatVersion: continuityContextFormatVersion,
    contentRole: "memory_data",
    personaId,
    items,
  };
}

function toContextItem(
  result: PersonaMemoryHybridRetrievalResult,
): ContinuityContextItem {
  const { personaMemory } = result;
  return {
    rank: result.rank,
    memoryId: personaMemory.memory.id,
    revisionId: personaMemory.memory.revisionId,
    memoryClass: personaMemory.memoryClass,
    type: personaMemory.memory.type,
    sensitivity: personaMemory.memory.sensitivity,
    assertion: personaMemory.memory.assertion,
    temporalStatus: result.temporalStatus,
    reviewDue: result.reviewDue,
  };
}

interface ContextSelection {
  composition: ContinuityContextComposition;
  results: PersonaMemoryHybridRetrievalResult[];
}

function composeSelection(
  personaId: string,
  ranked: readonly PersonaMemoryHybridRetrievalResult[],
  limits: Required<ContinuityContextLimits>,
): ContextSelection {
  const emptyJson = JSON.stringify(createPayload(personaId, []));
  if (Buffer.byteLength(emptyJson, "utf8") > limits.maxUtf8Bytes) {
    throw new Error("maxUtf8Bytes is too small for the Continuity context envelope.");
  }

  const items: ContinuityContextItem[] = [];
  const selected: PersonaMemoryHybridRetrievalResult[] = [];
  const classCounts: Record<PersonaMemoryClass, number> = {
    episodic: 0,
    durable: 0,
  };
  const omissionCounts: ContinuityContextOmissionCounts = {
    itemLimit: 0,
    byteLimit: 0,
    classLimit: 0,
  };

  for (const [index, result] of ranked.entries()) {
    if (result.personaMemory.personaId !== personaId) {
      throw new Error("A ranked memory crossed the requested persona boundary.");
    }
    if (items.length >= limits.maxItems) {
      omissionCounts.itemLimit += ranked.length - index;
      break;
    }
    const memoryClass = result.personaMemory.memoryClass;
    const classLimit =
      memoryClass === "episodic"
        ? limits.maxEpisodicItems
        : limits.maxDurableItems;
    if (classCounts[memoryClass] >= classLimit) {
      omissionCounts.classLimit += 1;
      continue;
    }
    const item = toContextItem(result);
    const candidateJson = JSON.stringify(createPayload(personaId, [...items, item]));
    if (Buffer.byteLength(candidateJson, "utf8") > limits.maxUtf8Bytes) {
      omissionCounts.byteLimit += 1;
      continue;
    }
    items.push(item);
    selected.push(result);
    classCounts[memoryClass] += 1;
  }

  const payload = createPayload(personaId, items);
  const contextJson = JSON.stringify(payload);
  const utf8Bytes = Buffer.byteLength(contextJson, "utf8");
  const omittedCount =
    omissionCounts.itemLimit +
    omissionCounts.byteLimit +
    omissionCounts.classLimit;
  return {
    composition: {
      payload,
      contextJson,
      utf8Bytes,
      limits,
      consideredCount: ranked.length,
      omittedCount,
      omissionCounts,
    },
    results: selected,
  };
}

export class ContinuityContextService {
  public constructor(
    private readonly embeddings: ContinuityEmbeddingService,
  ) {}

  public async compose(
    query: ContinuityContextQuery,
  ): Promise<ContinuityContextComposition> {
    const limits = normalizeLimits(query.contextLimits);
    composeSelection(query.personaId, [], limits);
    const { contextLimits: _contextLimits, ...retrievalQuery } = query;
    return this.embeddings.retrieveSelection(retrievalQuery, (ranked) => {
      const selection = composeSelection(query.personaId, ranked, limits);
      return {
        results: selection.results,
        value: selection.composition,
        contextComposition: {
          formatVersion: continuityContextFormatVersion,
          utf8Bytes: selection.composition.utf8Bytes,
          itemCount: selection.composition.payload.items.length,
          maxUtf8Bytes: limits.maxUtf8Bytes,
          maxItems: limits.maxItems,
        },
      };
    });
  }
}
