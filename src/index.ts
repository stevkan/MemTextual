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
export type {
  LegacyMemoryEntry,
  LegacyMemoryExport,
  LegacyMemoryMigrationItemResult,
  LegacyMemoryMigrationOptions,
  LegacyMemoryMigrationResult,
  LegacyMemorySource,
} from "./domain/legacy-migration.js";
export {
  reviewPolicyModes,
  type BulkReviewItemResult,
  type BulkReviewResult,
  type CandidateAutomationResult,
  type CandidateEvidenceFact,
  type CandidatePolicyDecision,
  type CandidatePolicyFacts,
  type PolicyAcceptanceAuthorization,
  type PolicyEvaluationCheck,
  type PolicyMutationContext,
  type ReviewPolicy,
  type ReviewPolicyConditions,
  type ReviewPolicyMode,
  type SetReviewPolicyInput,
  type TrustedSourceIdentity,
} from "./domain/review-policy.js";
export {
  resolveMcpRuntimeConfig,
  type McpRuntimeConfig,
  type ResolveMcpConfigOptions,
} from "./mcp/config.js";
export {
  createMemTextualMcpServer,
  mcpCapabilityCatalog,
  mcpServerName,
  mcpServerVersion,
  mcpToolCatalog,
} from "./mcp/server.js";
export type { MemoryRepository } from "./repositories/memory-repository.js";
export type { IngestionRepository } from "./repositories/ingestion-repository.js";
export type { ReviewPolicyRepository } from "./repositories/review-policy-repository.js";
export { SqliteIngestionRepository } from "./repositories/sqlite-ingestion-repository.js";
export { SqliteMemoryRepository } from "./repositories/sqlite-memory-repository.js";
export { SqliteReviewPolicyRepository } from "./repositories/sqlite-review-policy-repository.js";
export {
  CandidateNotFoundError,
  ExplicitCandidateReviewRequiredError,
  IngestionService,
  type CandidateAutomationProcessor,
  type CandidateProposalOptions,
} from "./services/ingestion-service.js";
export {
  createLegacyCandidateExternalId,
  LegacyMemoryMigrationService,
  parseLegacyMemoryExport,
  type LegacyMigrationScopeReader,
} from "./services/legacy-memory-migration-service.js";
export {
  ExplicitPolicyConfigurationRequiredError,
  ReviewAutomationService,
} from "./services/review-automation-service.js";
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
