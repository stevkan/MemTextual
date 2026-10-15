export {
  applyMigrations,
  openMemTextualDatabase,
  type OpenDatabaseOptions,
} from "./database/sqlite-database.js";
export {
  detectHostPlatform,
  hostPlatforms,
  type ExplicitHostMutationContext,
  type HostAdapterIdentity,
  type HostCredentialKind,
  type HostCredentialProvider,
  type HostCredentialReference,
  type HostIntegrationBundle,
  type HostPlatform,
  type HostPlatformDetection,
  type HostScheduleDefinition,
  type HostScheduledCommand,
  type HostSchedulerAdapter,
  type HostScheduleState,
  type HostServiceIdentityAdapter,
  type HostServiceIdentityRequest,
  type HostServiceIdentityState,
} from "./platform/host-platform.js";
export {
  WindowsServiceIdentityAdapter,
  WindowsTaskSchedulerAdapter,
  applyWindowsHostInstallation,
  applyWindowsHostRemoval,
  createWindowsHostIntegrationBundle,
  previewWindowsHostInstallation,
  previewWindowsHostRemoval,
  windowsHostIntegrationPlanFormatVersion,
  type WindowsHostInstallationPreview,
  type WindowsHostInstallationResult,
  type WindowsHostIntegrationConfiguration,
  type WindowsHostOperations,
  type WindowsManagedScheduleState,
  type WindowsPathProtectionState,
  type WindowsPathRestorationState,
  type WindowsProtectedPath,
  type WindowsHostRemovalPreview,
  type WindowsHostRemovalResult,
} from "./platform/windows-host-integration.js";
export {
  WindowsPowerShellHostOperations,
  createWindowsPowerShellBridge,
  type WindowsPowerShellBridge,
  type WindowsPowerShellBridgeOptions,
  type WindowsPowerShellHostAction,
  type WindowsPowerShellHostOperationsOptions,
} from "./platform/windows-powershell-host-operations.js";
export {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
  parseWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentEnvironment,
  validateWindowsContinuityDeploymentPlan,
  windowsContinuityDeploymentFormatVersion,
  type WindowsContinuityDeploymentConfiguration,
  type WindowsContinuityDeploymentPlan,
  type WindowsContinuityOffsiteDeployment,
} from "./platform/windows-continuity-deployment.js";
export {
  applyWindowsContinuityBundleStage,
  createWindowsContinuityBundle,
  previewWindowsContinuityBundleStage,
  verifyWindowsContinuityBundle,
  windowsContinuityBundleFormatVersion,
  type CreateWindowsContinuityBundleOptions,
  type WindowsContinuityBundleFile,
  type WindowsContinuityBundleManifest,
  type WindowsContinuityBundleVerification,
  type WindowsContinuityStagePreview,
} from "./packaging/windows-continuity-bundle.js";
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
  ContinuityOnboardingService,
  type ContinuityOnboardingInput,
  type ContinuityOnboardingResult,
  type ContinuityOnboardingUserStatus,
} from "./services/continuity-onboarding-service.js";
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
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
  type SnapshotResult,
  type VerificationResult,
} from "./safeguards/database-safeguard.js";
export {
  automaticBackupStateFormatVersion,
  getAutomaticBackupStatus,
  runAutomaticBackupIfDue,
  type AutomaticBackupHealth,
  type AutomaticBackupOptions,
  type AutomaticBackupRunResult,
  type AutomaticBackupState,
  type AutomaticBackupStatus,
} from "./safeguards/automatic-backup.js";
export {
  applyBackupRetention,
  backupRetentionReceiptFormatVersion,
  catalogDatabaseSnapshots,
  previewBackupRetention,
  type BackupRetentionDecision,
  type BackupRetentionOptions,
  type BackupRetentionPolicy,
  type BackupRetentionPreview,
  type BackupRetentionReceipt,
  type BackupRetentionSnapshot,
  type BackupSnapshotCatalog,
  type BackupSnapshotCatalogOptions,
  type VerifiedBackupSnapshot,
} from "./safeguards/backup-retention.js";
export {
  getRestoreDrillStatus,
  restoreDrillReportFormatVersion,
  restoreDrillStateFormatVersion,
  runRestoreDrillIfDue,
  type RestoreDrillHealth,
  type RestoreDrillOptions,
  type RestoreDrillReport,
  type RestoreDrillRunResult,
  type RestoreDrillState,
  type RestoreDrillStatus,
} from "./safeguards/restore-drill.js";
export {
  applyGuidedRestore,
  guidedRestoreReportFormatVersion,
  previewGuidedRestore,
  type GuidedRestoreOptions,
  type GuidedRestorePreview,
  type GuidedRestoreReport,
  type GuidedRestoreResult,
} from "./safeguards/guided-restore.js";
export {
  createEncryptedReplication,
  encryptedReplicationImportReceiptFormatVersion,
  encryptedReplicationManifestFormatVersion,
  encryptedReplicationVerificationFormatVersion,
  importEncryptedReplication,
  verifyEncryptedReplication,
  type CreateEncryptedReplicationOptions,
  type CreateEncryptedReplicationResult,
  type EncryptedReplicationFile,
  type EncryptedReplicationManifest,
  type EncryptedReplicationVerification,
  type ImportEncryptedReplicationOptions,
  type ImportEncryptedReplicationResult,
  type VerifyEncryptedReplicationOptions,
} from "./safeguards/encrypted-replication.js";
export {
  getOffsiteReplicationStatus,
  offsiteReplicationStateFormatVersion,
  runOffsiteReplicationIfDue,
  type OffsiteReplicationHealth,
  type OffsiteReplicationRunOptions,
  type OffsiteReplicationRunResult,
  type OffsiteReplicationState,
  type OffsiteReplicationStatus,
  type OffsiteReplicationStatusOptions,
} from "./safeguards/offsite-replication.js";
export {
  createLocalDirectoryReplicationAdapter,
  publishReplicationPackage,
  replicationDestinationReceiptFormatVersion,
  type PublishReplicationPackageOptions,
  type ReplicationDestinationAdapter,
  type ReplicationDestinationArtifact,
  type ReplicationDestinationMaterializeRequest,
  type ReplicationDestinationMaterializeResult,
  type ReplicationDestinationPackageRequest,
  type ReplicationDestinationPublishRequest,
  type ReplicationDestinationPublishResult,
  type ReplicationDestinationReceipt,
} from "./safeguards/replication-destination.js";
export {
  createAzureBlobReplicationAdapter,
  type AzureBlobReplicationDestinationOptions,
} from "./safeguards/azure-blob-replication-destination.js";
export {
  createAuthorizedAzureBlobReplicationAdapter,
  type AuthorizedAzureBlobReplicationAdapter,
} from "./safeguards/azure-blob-authorized-adapter.js";
export {
  getScheduledReplicationStatus,
  runScheduledReplicationIfDue,
  scheduledReplicationStateFormatVersion,
  type ScheduledReplicationHealth,
  type ScheduledReplicationRunOptions,
  type ScheduledReplicationRunResult,
  type ScheduledReplicationState,
  type ScheduledReplicationStatus,
  type ScheduledReplicationStatusOptions,
} from "./safeguards/scheduled-replication.js";
export {
  AzureCertificateCredentialProvider,
  azureCertificateCredentialConfigFormatVersion,
  loadAzureCertificateCredentialConfiguration,
  parseAzureCertificateCredentialConfiguration,
  type AzureCertificateCredentialConfiguration,
  type AzureCertificateCredentialHealth,
  type AzureCertificateCredentialProviderOptions,
  type AzureCertificateCredentialStatus,
} from "./credentials/azure-certificate-credential.js";
export {
  createConfiguredReplicationDestinationAdapter,
  loadReplicationDestinationConfiguration,
  parseReplicationDestinationConfiguration,
  replicationDestinationConfigFormatVersion,
  type AzureBlobReplicationDestinationConfiguration,
  type LocalDirectoryReplicationDestinationConfiguration,
  type ReplicationDestinationConfiguration,
} from "./safeguards/replication-destination-config.js";
