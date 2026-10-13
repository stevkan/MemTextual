import type {
  CandidateAcceptance,
  CandidateActor,
  CandidateMatch,
  CandidateResolution,
  CandidateResolutionInput,
  CandidateResolutionResult,
  CandidateStatus,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceRecord,
} from "../domain/ingestion.js";
import type { PolicyAcceptanceAuthorization } from "../domain/review-policy.js";
import type { Memory } from "../domain/memory.js";

export interface IngestionRepository {
  importSource(input: ImportSourceInput): SourceImportResult;
  listSources(limit?: number): Source[];
  getSourceRecord(id: string): SourceRecord | null;
  getSourceRecords(sourceId: string): SourceRecord[];
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
