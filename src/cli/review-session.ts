import type {
  CandidateEvidence,
  CandidateResolutionKind,
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

function resolutionAction(value: string): CandidateResolutionKind | null {
  const actions: Record<string, CandidateResolutionKind> = {
    a: "create",
    accept: "create",
    c: "create",
    create: "create",
    v: "revise",
    revise: "revise",
    f: "reaffirm",
    reaffirm: "reaffirm",
    x: "contradict",
    contradict: "contradict",
    u: "supersede",
    supersede: "supersede",
    i: "ignore",
    ignore: "ignore",
    r: "ignore",
    reject: "ignore",
  };
  return actions[value] ?? null;
}

function requiresTarget(outcome: CandidateResolutionKind): boolean {
  return ["revise", "reaffirm", "contradict", "supersede"].includes(outcome);
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
    const matches = service.findCandidateMatches(candidate.id);
    if (matches.length > 0) {
      io.write("Exact normalized matches:");
      for (const match of matches) {
        io.write(`  - ${match.memory.id}: ${match.memory.assertion}`);
      }
    }

    let decided = false;
    while (!decided) {
      const action = (await io.ask(
        "Create, revise, reaffirm, contradict, supersede, ignore, skip, or quit? [c/v/f/x/u/i/s/q] ",
      ))
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
      const outcome = resolutionAction(action);
      if (outcome === null) {
        io.write("Enter c, v, f, x, u, i, s, or q.");
        continue;
      }

      const targetMemoryId = requiresTarget(outcome)
        ? (await io.ask("Target memory ID: ")).trim()
        : undefined;
      if (requiresTarget(outcome) && targetMemoryId?.length === 0) {
        io.write(`${outcome} requires a target memory ID.`);
        continue;
      }
      const note = optionalNote(await io.ask("Optional review note: "));
      try {
        const resolved = service.resolveCandidate(
          candidate.id,
          {
            outcome,
            ...(targetMemoryId === undefined ? {} : { targetMemoryId }),
          },
          {
            actor: "user",
            explicitUserAction: true,
            ...(note === undefined ? {} : { note }),
          },
        );
        if (outcome !== "ignore") {
          summary.accepted += 1;
          io.write(
            `Resolved as ${outcome}${
              resolved.memory === null ? "." : ` using memory ${resolved.memory.id}.`
            }`,
          );
        } else {
          summary.rejected += 1;
          io.write("Ignored.");
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
