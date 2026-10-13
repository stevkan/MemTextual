import type { EmotionalContext } from "../domain/continuity-emotion.js";

function bounded(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function validateEmotionalContext(
  context: EmotionalContext,
): EmotionalContext {
  return {
    valence: bounded(context.valence, -1, 1, "valence"),
    activation: bounded(context.activation, 0, 1, "activation"),
    salience: bounded(context.salience, 0, 1, "salience"),
  };
}

export function emotionalRelevanceScore(
  query: EmotionalContext,
  memory: EmotionalContext,
): number {
  const normalizedQuery = validateEmotionalContext(query);
  const normalizedMemory = validateEmotionalContext(memory);
  const valenceSimilarity =
    1 - Math.abs(normalizedQuery.valence - normalizedMemory.valence) / 2;
  const activationSimilarity =
    1 - Math.abs(normalizedQuery.activation - normalizedMemory.activation);
  return (
    valenceSimilarity *
    activationSimilarity *
    normalizedQuery.salience *
    normalizedMemory.salience
  );
}
