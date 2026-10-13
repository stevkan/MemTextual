import type {
  CandidateAcceptance,
  CandidateMatch,
  CandidateSemanticMatcher,
  CandidateResolutionInput,
  CandidateResolutionResult,
  CandidateReviewContext,
  CandidateStatus,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceRecord,
} from "../domain/ingestion.js";
import { candidateMatchKinds } from "../domain/ingestion.js";
import type {
  BulkReviewResult,
  CandidateAutomationResult,
} from "../domain/review-policy.js";
import type { IngestionRepository } from "../repositories/ingestion-repository.js";

export interface CandidateAutomationProcessor {
  processCandidate(candidateId: string): CandidateAutomationResult;
  bulkReview(
    candidateIds: string[],
    action: "accept" | "reject",
    note?: string,
    context?: CandidateReviewContext,
  ): BulkReviewResult;
}

export interface CandidateProposalOptions {
  processAutomation?: boolean;
}

export class CandidateNotFoundError extends Error {
  public constructor(id: string) {
    super(`Memory candidate not found: ${id}`);
    this.name = "CandidateNotFoundError";
  }
}

export class ExplicitCandidateReviewRequiredError extends Error {
  public constructor() {
    super("Accepting or rejecting a memory candidate requires an explicit user action.");
    this.name = "ExplicitCandidateReviewRequiredError";
  }
}

export class IngestionService {
  public constructor(
    private readonly repository: IngestionRepository,
    private readonly automation?: CandidateAutomationProcessor,
    private readonly semanticMatcher?: CandidateSemanticMatcher,
  ) {}

  public importSource(input: ImportSourceInput): SourceImportResult {
    return this.repository.importSource(input);
  }

  public listSources(limit?: number): Source[] {
    return this.repository.listSources(limit);
  }

  public getSourceHistory(kind: Source["kind"], externalId: string): Source[] {
    return this.repository.getSourceHistory(kind, externalId);
  }

  public getSourceRecord(id: string): SourceRecord | null {
    return this.repository.getSourceRecord(id);
  }

  public getSourceRecords(sourceId: string): SourceRecord[] {
    return this.repository.getSourceRecords(sourceId);
  }

  public proposeCandidate(
    input: ProposeMemoryCandidateInput,
    options: CandidateProposalOptions = {},
  ): MemoryCandidate {
    const candidate = this.repository.proposeCandidate(input);
    if (this.automation === undefined || options.processAutomation === false) {
      return candidate;
    }
    try {
      const processed = this.automation.processCandidate(candidate.id);
      return processed.acceptance?.candidate ?? this.requireCandidate(candidate.id);
    } catch {
      return candidate;
    }
  }

  public getCandidate(id: string): MemoryCandidate | null {
    return this.repository.getCandidate(id);
  }

  public getCandidateByExternalId(externalId: string): MemoryCandidate | null {
    return this.repository.getCandidateByExternalId(externalId);
  }

  public listCandidates(
    status?: CandidateStatus,
    limit?: number,
  ): MemoryCandidate[] {
    return this.repository.listCandidates(status, limit);
  }

  public findCandidateMatches(id: string, limit?: number): CandidateMatch[] {
    const candidate = this.requireCandidate(id);
    const exact = this.repository.findCandidateMatches(id, limit);
    if (this.semanticMatcher === undefined) {
      return exact;
    }
    if (
      this.semanticMatcher.id.trim().length === 0 ||
      this.semanticMatcher.version.trim().length === 0
    ) {
      throw new Error("A semantic matcher requires a stable ID and version.");
    }

    const memories = this.repository.listCandidateMatchTargets(id, 500);
    const eligible = new Map(memories.map((memory) => [memory.id, memory]));
    const semantic = this.semanticMatcher.match({ candidate, memories }).map(
      (proposal): CandidateMatch => {
        const memory = eligible.get(proposal.memoryId);
        if (memory === undefined) {
          throw new Error(
            `Semantic matcher ${this.semanticMatcher!.id} returned an ineligible memory.`,
          );
        }
        const matchKind = proposal.matchKind as string;
        if (
          !candidateMatchKinds.includes(
            matchKind as (typeof candidateMatchKinds)[number],
          ) ||
          matchKind === "exact_normalized"
        ) {
          throw new Error(
            `Semantic matcher ${this.semanticMatcher!.id} returned an invalid match kind.`,
          );
        }
        if (
          !Number.isFinite(proposal.score) ||
          proposal.score < 0 ||
          proposal.score > 1
        ) {
          throw new Error(
            `Semantic matcher ${this.semanticMatcher!.id} returned an invalid score.`,
          );
        }
        const reason = proposal.reason.trim();
        if (reason.length === 0) {
          throw new Error(
            `Semantic matcher ${this.semanticMatcher!.id} returned an empty reason.`,
          );
        }
        return {
          memory,
          matchKind: proposal.matchKind,
          score: proposal.score,
          reason,
          matcherId: this.semanticMatcher!.id,
          matcherVersion: this.semanticMatcher!.version,
        };
      },
    );

    const byMemory = new Map<string, CandidateMatch>();
    for (const match of [...semantic, ...exact]) {
      const existing = byMemory.get(match.memory.id);
      if (
        existing === undefined ||
        match.matchKind === "exact_normalized" ||
        match.score > existing.score
      ) {
        byMemory.set(match.memory.id, match);
      }
    }
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit ?? 20), 100));
    return [...byMemory.values()]
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.memory.id.localeCompare(right.memory.id),
      )
      .slice(0, safeLimit);
  }

  public resolveCandidate(
    id: string,
    resolution: CandidateResolutionInput,
    context: CandidateReviewContext = {},
  ): CandidateResolutionResult {
    this.requireCandidate(id);
    this.requireExplicitUserReview(context);
    return this.repository.resolveCandidate(id, resolution, "user", context.note);
  }

  public acceptCandidate(
    id: string,
    context: CandidateReviewContext = {},
  ): CandidateAcceptance {
    this.requireCandidate(id);
    this.requireExplicitUserReview(context);
    return this.repository.acceptCandidate(id, "user", context.note);
  }

  public rejectCandidate(
    id: string,
    context: CandidateReviewContext = {},
  ): MemoryCandidate {
    this.requireCandidate(id);
    this.requireExplicitUserReview(context);
    return this.repository.rejectCandidate(id, "user", context.note);
  }

  public bulkReviewCandidates(
    candidateIds: string[],
    action: "accept" | "reject",
    context: CandidateReviewContext = {},
  ): BulkReviewResult {
    this.requireExplicitUserReview(context);
    if (this.automation === undefined) {
      throw new Error("Bulk candidate review is not configured.");
    }
    const uniqueIds = [...new Set(candidateIds.map((id) => id.trim()))].filter(
      (id) => id.length > 0,
    );
    if (uniqueIds.length === 0) {
      throw new Error("Bulk candidate review requires at least one candidate ID.");
    }
    return this.automation.bulkReview(uniqueIds, action, context.note, context);
  }

  private requireCandidate(id: string): MemoryCandidate {
    const candidate = this.repository.getCandidate(id);
    if (candidate === null) {
      throw new CandidateNotFoundError(id);
    }
    return candidate;
  }

  private requireExplicitUserReview(context: CandidateReviewContext): void {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitCandidateReviewRequiredError();
    }
  }
}
