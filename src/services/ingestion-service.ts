import type {
  CandidateAcceptance,
  CandidateReviewContext,
  CandidateStatus,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceRecord,
} from "../domain/ingestion.js";
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
  ) {}

  public importSource(input: ImportSourceInput): SourceImportResult {
    return this.repository.importSource(input);
  }

  public listSources(limit?: number): Source[] {
    return this.repository.listSources(limit);
  }

  public getSourceRecord(id: string): SourceRecord | null {
    return this.repository.getSourceRecord(id);
  }

  public getSourceRecords(sourceId: string): SourceRecord[] {
    return this.repository.getSourceRecords(sourceId);
  }

  public proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate {
    const candidate = this.repository.proposeCandidate(input);
    if (this.automation === undefined) {
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

  public listCandidates(
    status?: CandidateStatus,
    limit?: number,
  ): MemoryCandidate[] {
    return this.repository.listCandidates(status, limit);
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
