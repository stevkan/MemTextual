import type {
  CandidateEvidence,
  MemoryCandidate,
  SourceRecord,
} from "../domain/ingestion.js";
import type { IngestionService } from "../services/ingestion-service.js";

export interface CandidateReviewIO {
  ask(prompt: string): Promise<string>;
  write(message: string): void;
}

export interface CandidateReviewSummary {
  reviewed: number;
  accepted: number;
  rejected: number;
  skipped: number;
  failed: number;
  quitEarly: boolean;
}

function indent(value: string, prefix = "      "): string {
  return value
    .split(/\r?\n/u)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function evidenceText(
  evidence: CandidateEvidence,
  record: SourceRecord | null,
): string {
  const heading = `  - ${evidence.role}: ${evidence.sourceRecordId}`;
  if (record === null) {
    return `${heading}\n      Source record is unavailable.`;
  }

  const author = [record.authorRole, record.authorName]
    .filter((value): value is string => value !== null)
    .join(" / ");
  const details = [
    `      Source: ${record.sourceId}; record ${record.ordinal}; ${record.kind}`,
    ...(author.length === 0 ? [] : [`      Author: ${author}`]),
    "      Content:",
    indent(record.content),
  ];
  if (evidence.excerpt !== null && evidence.excerpt !== record.content) {
    details.push("      Selected excerpt:", indent(evidence.excerpt));
  }
  return [heading, ...details].join("\n");
}

export function formatCandidateForReview(
  candidate: MemoryCandidate,
  records: ReadonlyMap<string, SourceRecord | null>,
): string {
  const controls = [
    candidate.retrievalPolicy,
    candidate.sensitivity,
    candidate.isPinned ? "pinned" : null,
    candidate.isProtected ? "protected" : null,
  ].filter((value): value is string => value !== null);

  return [
    `Candidate: ${candidate.id}`,
    `Assertion: ${candidate.assertion}`,
    ...(candidate.normalizedAssertion === null
      ? []
      : [`Normalized: ${candidate.normalizedAssertion}`]),
    `Type: ${candidate.type}`,
    `Scope: ${candidate.scopeId}`,
    `Explicitness: ${candidate.explicitness}`,
    `Confidence: ${candidate.confidence}`,
    `Proposed by: ${candidate.proposedBy}`,
    `Controls: ${controls.join(", ")}`,
    "Evidence:",
    ...candidate.evidence.map((evidence) =>
      evidenceText(evidence, records.get(evidence.sourceRecordId) ?? null),
    ),
  ].join("\n");
}

function optionalNote(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function reviewPendingCandidates(
  service: IngestionService,
  io: CandidateReviewIO,
): Promise<CandidateReviewSummary> {
  const candidates = service.listCandidates("pending", 100);
  const summary: CandidateReviewSummary = {
    reviewed: 0,
    accepted: 0,
    rejected: 0,
    skipped: 0,
    failed: 0,
    quitEarly: false,
  };

  if (candidates.length === 0) {
    io.write("No pending memory candidates.");
    return summary;
  }

  io.write(`Pending candidates: ${candidates.length}`);

  for (const [index, candidate] of candidates.entries()) {
    const records = new Map<string, SourceRecord | null>();
    for (const evidence of candidate.evidence) {
      records.set(
        evidence.sourceRecordId,
        service.getSourceRecord(evidence.sourceRecordId),
      );
    }

    io.write("");
    io.write(`Review ${index + 1} of ${candidates.length}`);
    io.write(formatCandidateForReview(candidate, records));

    let decided = false;
    while (!decided) {
      const action = (await io.ask("Accept, reject, skip, or quit? [a/r/s/q] "))
        .trim()
        .toLowerCase();

      if (action === "q" || action === "quit") {
        summary.quitEarly = true;
        decided = true;
        break;
      }
      if (action === "s" || action === "skip") {
        summary.skipped += 1;
        decided = true;
        continue;
      }
      if (action !== "a" && action !== "accept" && action !== "r" && action !== "reject") {
        io.write("Enter a, r, s, or q.");
        continue;
      }

      const note = optionalNote(await io.ask("Optional review note: "));
      try {
        if (action === "a" || action === "accept") {
          const accepted = service.acceptCandidate(candidate.id, {
            actor: "user",
            explicitUserAction: true,
            ...(note === undefined ? {} : { note }),
          });
          summary.accepted += 1;
          io.write(`Accepted as memory ${accepted.memory.id}.`);
        } else {
          service.rejectCandidate(candidate.id, {
            actor: "user",
            explicitUserAction: true,
            ...(note === undefined ? {} : { note }),
          });
          summary.rejected += 1;
          io.write("Rejected.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown review error";
        summary.failed += 1;
        io.write(`Review failed: ${message}`);
      }
      summary.reviewed += 1;
      decided = true;
    }

    if (summary.quitEarly) {
      break;
    }
  }

  io.write("");
  io.write(
    `Review summary: ${summary.accepted} accepted, ${summary.rejected} rejected, ` +
      `${summary.skipped} skipped, ${summary.failed} failed.`,
  );
  return summary;
}
