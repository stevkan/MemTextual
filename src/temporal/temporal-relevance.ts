import type { TemporalStatus } from "../domain/memory.js";

const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface TemporalWindowInput {
  validFrom?: string | null;
  validTo?: string | null;
  reviewAfter?: string | null;
}

export interface NormalizedTemporalWindow {
  validFrom: string | null;
  validTo: string | null;
  reviewAfter: string | null;
}

export function normalizeTimestamp(value: string, label: string): string {
  const normalized = value.trim();
  if (!isoTimestampPattern.test(normalized)) {
    throw new Error(`${label} must be an ISO 8601 timestamp with a timezone.`);
  }
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function normalizeOptionalTimestamp(
  value: string | null | undefined,
  label: string,
): string | null {
  return value === null || value === undefined
    ? null
    : normalizeTimestamp(value, label);
}

export function normalizeTemporalWindow(
  input: TemporalWindowInput,
): NormalizedTemporalWindow {
  const validFrom = normalizeOptionalTimestamp(input.validFrom, "validFrom");
  const validTo = normalizeOptionalTimestamp(input.validTo, "validTo");
  const reviewAfter = normalizeOptionalTimestamp(
    input.reviewAfter,
    "reviewAfter",
  );
  if (validFrom !== null && validTo !== null && validTo < validFrom) {
    throw new Error("validTo must not be earlier than validFrom.");
  }
  return { validFrom, validTo, reviewAfter };
}

export function resolveAsOf(asOf?: string): string {
  return asOf === undefined
    ? new Date().toISOString()
    : normalizeTimestamp(asOf, "asOf");
}

export function temporalState(
  window: NormalizedTemporalWindow,
  asOf: string,
): { temporalStatus: TemporalStatus; reviewDue: boolean } {
  const asOfMilliseconds = Date.parse(asOf);
  const validFromMilliseconds =
    window.validFrom === null ? null : Date.parse(window.validFrom);
  const validToMilliseconds =
    window.validTo === null ? null : Date.parse(window.validTo);
  const reviewAfterMilliseconds =
    window.reviewAfter === null ? null : Date.parse(window.reviewAfter);
  const temporalStatus: TemporalStatus =
    validFromMilliseconds !== null && validFromMilliseconds > asOfMilliseconds
      ? "not_yet_valid"
      : validToMilliseconds !== null && validToMilliseconds < asOfMilliseconds
        ? "expired"
        : "current";
  return {
    temporalStatus,
    reviewDue:
      reviewAfterMilliseconds !== null &&
      reviewAfterMilliseconds <= asOfMilliseconds,
  };
}
