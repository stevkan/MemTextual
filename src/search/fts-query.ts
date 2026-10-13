export function toFtsQuery(query: string): string | null {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu);
  if (terms === null || terms.length === 0) {
    return null;
  }

  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
}

export function sqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function normalizeRetrievalLimit(limit = 20): number {
  if (!Number.isFinite(limit)) {
    throw new Error("A retrieval limit must be a finite number.");
  }
  return Math.max(1, Math.min(Math.trunc(limit), 100));
}
