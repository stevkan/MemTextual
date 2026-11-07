import type {
  CandidateAcceptance,
  CandidateActor,
  CandidateMatch,
  CandidateResolution,
  CandidateResolutionInput,
  CandidateResolutionResult,
  CandidateStatus,
  DeleteSourceSeriesInput,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceSeriesIdentity,
  SourceSeriesPurgePreview,
  SourceSeriesPurgeReceipt,
  SourceRecord,
} from "../domain/ingestion.js";
import type { PolicyAcceptanceAuthorization } from "../domain/review-policy.js";
import type { Memory } from "../domain/memory.js";

export interface IngestionRepository {
  importSource(input: ImportSourceInput): SourceImportResult;
  listSources(limit?: number): Source[];
  getSource(id: string): Source | null;
  getSourceHistory(kind: Source["kind"], externalId: string): Source[];
  getSourceRecord(id: string): SourceRecord | null;
  getSourceRecords(sourceId: string): SourceRecord[];
  deleteSourceSeries(
    input: DeleteSourceSeriesInput,
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): Source[];
  restoreSourceSeries(
    input: SourceSeriesIdentity,
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): Source[];
  previewSourceSeriesPurge(input: SourceSeriesIdentity): SourceSeriesPurgePreview;
  purgeSourceSeries(
    input: SourceSeriesIdentity & { reason: string },
    actor: CandidateActor,
    explicitUserAction: boolean,
  ): SourceSeriesPurgeReceipt;
  proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate;
  getCandidateByExternalId(externalId: string): MemoryCandidate | null;
  getCandidate(id: string): MemoryCandidate | null;
  listCandidates(status?: CandidateStatus, limit?: number): MemoryCandidate[];
  findCandidateMatches(id: string, limit?: number): CandidateMatch[];
  listCandidateMatchTargets(id: string, limit?: number): Memory[];
  getCandidateResolution(id: string): CandidateResolution | null;
  resolveCandidate(
    id: string,
    resolution: CandidateResolutionInput,
    actor: CandidateActor,
    note?: string,
  ): CandidateResolutionResult;
  acceptCandidate(
    id: string,
    actor: CandidateActor,
    note?: string,
    policyAuthorization?: PolicyAcceptanceAuthorization,
  ): CandidateAcceptance;
  rejectCandidate(id: string, actor: CandidateActor, note?: string): MemoryCandidate;
}
