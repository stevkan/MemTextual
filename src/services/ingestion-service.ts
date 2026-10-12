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
import type { IngestionRepository } from "../repositories/ingestion-repository.js";

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
  public constructor(private readonly repository: IngestionRepository) {}

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
    return this.repository.proposeCandidate(input);
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
