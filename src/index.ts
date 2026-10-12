export {
  applyMigrations,
  openMemTextualDatabase,
  type OpenDatabaseOptions,
} from "./database/sqlite-database.js";
export {
  memoryStatuses,
  memoryTypes,
  type CreateMemoryInput,
  type CreateScopeInput,
  type Explicitness,
  type Memory,
  type MemoryActor,
  type MemoryChangeKind,
  type MemoryMutationContext,
  type MemoryRevision,
  type MemoryScope,
  type MemoryStatus,
  type MemoryType,
  type RetrievalQuery,
  type RetrievalPolicy,
  type RetrievalResult,
  type ReviseMemoryInput,
  type Scope,
  type ScopeKind,
  type Sensitivity,
} from "./domain/memory.js";
export {
  sourceKinds,
  sourceRecordKinds,
  type CandidateAcceptance,
  type CandidateActor,
  type CandidateEvidence,
  type CandidateEvidenceInput,
  type CandidateReviewContext,
  type CandidateStatus,
  type EvidenceRole,
  type ImportSourceInput,
  type ImportSourceRecordInput,
  type MemoryCandidate,
  type ProposeMemoryCandidateInput,
  type Source,
  type SourceImportResult,
  type SourceKind,
  type SourceRecord,
  type SourceRecordKind,
} from "./domain/ingestion.js";
export {
  resolveMcpRuntimeConfig,
  type McpRuntimeConfig,
  type ResolveMcpConfigOptions,
} from "./mcp/config.js";
export {
  createMemTextualMcpServer,
  mcpServerName,
  mcpServerVersion,
} from "./mcp/server.js";
export type { MemoryRepository } from "./repositories/memory-repository.js";
export type { IngestionRepository } from "./repositories/ingestion-repository.js";
export { SqliteIngestionRepository } from "./repositories/sqlite-ingestion-repository.js";
export { SqliteMemoryRepository } from "./repositories/sqlite-memory-repository.js";
export {
  CandidateNotFoundError,
  ExplicitCandidateReviewRequiredError,
  IngestionService,
} from "./services/ingestion-service.js";
export {
  formatCandidateForReview,
  reviewPendingCandidates,
  type CandidateReviewIO,
  type CandidateReviewSummary,
} from "./cli/review-session.js";
export {
  MemoryNotFoundError,
  MemoryService,
  ProtectedMemoryError,
} from "./services/memory-service.js";
