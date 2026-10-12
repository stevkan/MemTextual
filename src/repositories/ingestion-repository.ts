import type {
  CandidateAcceptance,
  CandidateActor,
  CandidateStatus,
  ImportSourceInput,
  MemoryCandidate,
  ProposeMemoryCandidateInput,
  Source,
  SourceImportResult,
  SourceRecord,
} from "../domain/ingestion.js";

export interface IngestionRepository {
  importSource(input: ImportSourceInput): SourceImportResult;
  listSources(limit?: number): Source[];
  getSourceRecord(id: string): SourceRecord | null;
  getSourceRecords(sourceId: string): SourceRecord[];
  proposeCandidate(input: ProposeMemoryCandidateInput): MemoryCandidate;
  getCandidate(id: string): MemoryCandidate | null;
  listCandidates(status?: CandidateStatus, limit?: number): MemoryCandidate[];
  acceptCandidate(id: string, actor: CandidateActor, note?: string): CandidateAcceptance;
  rejectCandidate(id: string, actor: CandidateActor, note?: string): MemoryCandidate;
}
