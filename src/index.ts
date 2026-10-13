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
  type DeleteMemoryInput,
  type Explicitness,
  type Memory,
  type MemoryActor,
  type MemoryChangeKind,
  type MemoryMutationContext,
  type MemoryPurgePreview,
  type MemoryPurgeReceipt,
  type MemoryRevision,
  type MemoryScope,
  type MemoryStatus,
  type MemoryType,
  type RetrievalQuery,
  type RetrievalPolicy,
  type RetrievalResult,
  type ReviseMemoryInput,
  type PurgeMemoryInput,
  type Scope,
  type ScopeKind,
  type Sensitivity,
  type TemporalStatus,
} from "./domain/memory.js";
export {
  personaMemoryClasses,
  type ContinuityRetrievalQuery,
  type CreatePersonaMemoryInput,
  type PersonaMemory,
  type PersonaMemoryClass,
  type PersonaMemoryRetrievalResult,
} from "./domain/continuity-memory.js";
export type {
  ContinuityContextRetrievalAudit,
  ContinuityEmbeddingProvider,
  ContinuityEmbeddingSource,
  ContinuityHybridRetrievalQuery,
  ContinuityQueryEmbedding,
  EmbeddingProviderIdentity,
  EmbeddingPurpose,
  EmbeddingRequest,
  PersonaMemoryHybridRetrievalResult,
  StoreContinuityEmbeddingInput,
  StoredContinuityEmbedding,
} from "./domain/continuity-embedding.js";
export {
  continuityContextFormat,
  continuityContextFormatVersion,
  defaultContinuityContextMaxItems,
  defaultContinuityContextMaxUtf8Bytes,
  maximumContinuityContextMaxItems,
  maximumContinuityContextMaxUtf8Bytes,
  type ContinuityContextComposition,
  type ContinuityContextItem,
  type ContinuityContextLimits,
  type ContinuityContextOmissionCounts,
  type ContinuityContextPayload,
  type ContinuityContextQuery,
} from "./domain/continuity-context.js";
export type {
  PersonaRankingProfile,
  PersonaRankingSignals,
  RankingMutationContext,
  UpdatePersonaRankingProfileInput,
} from "./domain/continuity-ranking.js";
export type {
  AnnotatePersonaMemoryEmotionInput,
  EmotionAnnotationMutationContext,
  EmotionalContext,
  PersonaMemoryEmotionProfile,
} from "./domain/continuity-emotion.js";
export type {
  AmbientCaptureResult,
  AmbientExtractionInput,
  AmbientExtractionProvider,
  AmbientMemoryExtractor,
  AmbientMemoryProposal,
  AmbientSensitivityAssessment,
  AmbientSensitivityClassifier,
  AmbientSensitivityInput,
  CaptureAmbientInteractionInput,
} from "./domain/ambient-memory.js";
export type {
  AuthorizeHostInput,
  CaptureAuthorizedHostEventInput,
  HostAuthorization,
  HostAuthorizationGrant,
  HostAuthorizationMutationContext,
  HostAuthorizationStatus,
  HostEventAdapter,
  HostEventAdapterInput,
  HostEventCaptureResult,
  HostEventEnvelope,
  HostEventReceipt,
} from "./domain/host-event.js";
export {
  continuityPersonaMemoryExportFormat,
  type ContinuityPersonaMemoryExport,
  type ContinuityCandidateEvidenceView,
  type ContinuityCandidateQueueItem,
  type ContinuityCandidateQueueQuery,
  type ContinuityCandidateResolutionRequest,
  type ContinuityCandidateReview,
  type ContinuityControlMutationContext,
  type ContinuityMemoryDeletionRequest,
  type ContinuityMemoryDetail,
  type ContinuityMemoryPurgeRequest,
  type ContinuityMemoryRevisionRequest,
} from "./domain/continuity-control.js";
export type {
  ContinuityUser,
  CreateContinuityUserInput,
  CreatePersonaInput,
  Persona,
  PersonaContext,
  PersonaMetadata,
  PersonaRelationship,
} from "./domain/persona.js";
export {
  sourceKinds,
  sourceRecordKinds,
  candidateResolutionKinds,
  candidateMatchKinds,
  type CandidateAcceptance,
  type AmbientCandidateContext,
  type AmbientSensitivityAssessmentContext,
  type CandidateActor,
  type CandidateEvidence,
  type CandidateEvidenceInput,
  type CandidateMatch,
  type CandidateMatchKind,
  type CandidateResolution,
  type CandidateResolutionInput,
  type CandidateResolutionKind,
  type CandidateResolutionResult,
  type CandidateSemanticMatcher,
  type CandidateSemanticMatchInput,
  type CandidateSemanticMatchProposal,
  type CandidateReviewContext,
  type CandidateStatus,
  type DeleteSourceSeriesInput,
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
  type SourceMutationContext,
  type SourceSeriesIdentity,
  type SourceSeriesPurgePreview,
  type SourceSeriesPurgeReceipt,
  type PurgeSourceSeriesInput,
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
export type { ContinuityMemoryRepository } from "./repositories/continuity-memory-repository.js";
export type { ContinuityEmbeddingRepository } from "./repositories/continuity-embedding-repository.js";
export type { ContinuityRankingRepository } from "./repositories/continuity-ranking-repository.js";
export type { ContinuityEmotionRepository } from "./repositories/continuity-emotion-repository.js";
export type { IngestionRepository } from "./repositories/ingestion-repository.js";
export type { PersonaRepository } from "./repositories/persona-repository.js";
export type { ReviewPolicyRepository } from "./repositories/review-policy-repository.js";
export type {
  ContinuityCandidateBinding,
  ContinuityControlRepository,
} from "./repositories/continuity-control-repository.js";
export type {
  CreateHostAuthorizationRecordInput,
  HostAuthorizationCredential,
  HostEventRepository,
  RecordHostEventInput,
} from "./repositories/host-event-repository.js";
export { SqliteIngestionRepository } from "./repositories/sqlite-ingestion-repository.js";
export { SqliteContinuityMemoryRepository } from "./repositories/sqlite-continuity-memory-repository.js";
export { SqliteContinuityRankingRepository } from "./repositories/sqlite-continuity-ranking-repository.js";
export { SqliteContinuityEmotionRepository } from "./repositories/sqlite-continuity-emotion-repository.js";
export { SqliteMemoryRepository } from "./repositories/sqlite-memory-repository.js";
export { SqlitePersonaRepository } from "./repositories/sqlite-persona-repository.js";
export { SqliteReviewPolicyRepository } from "./repositories/sqlite-review-policy-repository.js";
export { SqliteHostEventRepository } from "./repositories/sqlite-host-event-repository.js";
export {
  SqliteContinuityControlRepository,
} from "./repositories/sqlite-continuity-control-repository.js";
export {
  CandidateNotFoundError,
  ExplicitCandidateReviewRequiredError,
  ExplicitSourceMutationRequiredError,
  IngestionService,
  type CandidateAutomationProcessor,
  type CandidateProposalOptions,
} from "./services/ingestion-service.js";
export { ContinuityMemoryService } from "./services/continuity-memory-service.js";
export { ContinuityEmbeddingService } from "./services/continuity-embedding-service.js";
export { ContinuityContextService } from "./services/continuity-context-service.js";
export {
  ContinuityRankingService,
  ExplicitRankingConfigurationRequiredError,
} from "./services/continuity-ranking-service.js";
export {
  ContinuityEmotionService,
  ExplicitEmotionAnnotationRequiredError,
} from "./services/continuity-emotion-service.js";
export {
  emotionalRelevanceScore,
  validateEmotionalContext,
} from "./emotion/emotional-relevance.js";
export {
  ContinuityControlService,
  ExplicitContinuityControlActionRequiredError,
} from "./services/continuity-control-service.js";
export { AmbientMemoryService } from "./services/ambient-memory-service.js";
export {
  AuthorizedHostEventCaptureService,
  HostAuthorizationService,
} from "./services/host-event-service.js";
export {
  StructuredAmbientMemoryExtractor,
  type StructuredAmbientExtractorOptions,
} from "./providers/structured-ambient-extractor.js";
export {
  createContinuityConsoleApplication,
  startContinuityConsole,
  type ContinuityConsoleApplication,
  type ContinuityConsoleHandle,
  type ContinuityConsoleRequest,
  type ContinuityConsoleResponse,
  type StartContinuityConsoleOptions,
} from "./ui/continuity-console.js";
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
export { PersonaService } from "./services/persona-service.js";
export {
  formatCandidateForReview,
  reviewPendingCandidates,
  type CandidateReviewIO,
  type CandidateReviewSummary,
} from "./cli/review-session.js";
export {
  ExplicitUserActionRequiredError,
  MemoryNotFoundError,
  MemoryService,
  ProtectedMemoryError,
} from "./services/memory-service.js";
export {
  createDatabaseSnapshot,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
  type SnapshotResult,
  type VerificationResult,
} from "./safeguards/database-safeguard.js";
