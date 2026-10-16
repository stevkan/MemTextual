import type Database from "better-sqlite3";
import type { AmbientSensitivityClassifier } from "../domain/ambient-memory.js";
import type { ConversationGrantStore } from "../domain/conversation-grant-store.js";
import type {
  ConversationHost,
  DeletableConversationHost,
} from "../domain/conversation-host.js";
import {
  CodexAppServerConversationHost,
  type CodexAppServerConversationHostOptions,
} from "../hosts/codex-app-server-conversation-host.js";
import { ContinuityConversationTurnAdapter } from "../hosts/continuity-conversation-turn-adapter.js";
import { WindowsDpapiConversationGrantStore } from "../platform/windows-dpapi-conversation-grant-store.js";
import type { WindowsPowerShellBridge } from "../platform/windows-powershell-host-operations.js";
import {
  CodexAppServerAmbientExtractionProvider,
  type CodexAppServerStructuredTaskRunner,
} from "../providers/codex-app-server-ambient-extraction-provider.js";
import { StructuredAmbientMemoryExtractor } from "../providers/structured-ambient-extractor.js";
import { SqliteContinuityConversationRepository } from "../repositories/sqlite-continuity-conversation-repository.js";
import { SqliteContinuityMemoryRepository } from "../repositories/sqlite-continuity-memory-repository.js";
import { SqliteContinuityPersonaBehaviorRepository } from "../repositories/sqlite-continuity-persona-behavior-repository.js";
import { SqliteHostEventRepository } from "../repositories/sqlite-host-event-repository.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { AmbientMemoryService } from "../services/ambient-memory-service.js";
import { ContinuityLexicalContextService } from "../services/continuity-context-service.js";
import { ContinuityConversationAuthorizationService } from "../services/continuity-conversation-authorization-service.js";
import { ContinuityConversationClientCoordinator } from "../services/continuity-conversation-client-coordinator.js";
import { ContinuityConversationHostDeletionService } from "../services/continuity-conversation-host-deletion-service.js";
import { ContinuityConversationProtectedClient } from "../services/continuity-conversation-protected-client.js";
import { ContinuityConversationService } from "../services/continuity-conversation-service.js";
import { ContinuityPersonaBehaviorService } from "../services/continuity-persona-behavior-service.js";
import {
  AuthorizedHostEventCaptureService,
  HostAuthorizationService,
} from "../services/host-event-service.js";
import { IngestionService } from "../services/ingestion-service.js";

export type StructuredConversationHost = ConversationHost &
  CodexAppServerStructuredTaskRunner &
  DeletableConversationHost;

export interface ContinuityConversationRuntimeOptions {
  database: Database.Database;
  extractionModel: string;
  grantStore: ConversationGrantStore;
  host: StructuredConversationHost;
  now?: () => Date;
  sensitivityClassifier?: AmbientSensitivityClassifier;
}

export interface ContinuityConversationRuntime {
  authorizations: ContinuityConversationAuthorizationService;
  client: ContinuityConversationProtectedClient;
  hostDeletion: ContinuityConversationHostDeletionService;
  hostIdentity: ConversationHost["identity"];
  close(): Promise<void>;
}

export interface WindowsCodexContinuityConversationRuntimeOptions {
  bridge: WindowsPowerShellBridge;
  database: Database.Database;
  extractionModel: string;
  workingDirectory: string;
  hostOptions?: Omit<CodexAppServerConversationHostOptions, "workingDirectory">;
  now?: () => Date;
  sensitivityClassifier?: AmbientSensitivityClassifier;
}

/**
 * Composes the trusted server-side conversation boundary. The runtime takes
 * ownership of the supplied host and closes it exactly once; it does not own
 * or close the caller's database.
 */
export function createContinuityConversationRuntime(
  options: ContinuityConversationRuntimeOptions,
): ContinuityConversationRuntime {
  const extractionModel = options.extractionModel.trim();
  if (extractionModel.length === 0) {
    throw new TypeError("extractionModel must not be empty.");
  }

  const memories = new SqliteMemoryRepository(options.database);
  const personas = new SqlitePersonaRepository(options.database);
  const continuityMemories = new SqliteContinuityMemoryRepository(
    options.database,
    memories,
  );
  const conversations = new SqliteContinuityConversationRepository(
    options.database,
  );
  const hostEvents = new SqliteHostEventRepository(options.database);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(options.database, memories),
  );
  const extractionProvider = new CodexAppServerAmbientExtractionProvider(
    options.host,
    { model: extractionModel },
  );
  const ambient = new AmbientMemoryService(
    ingestion,
    personas,
    new StructuredAmbientMemoryExtractor(extractionProvider),
    options.sensitivityClassifier,
  );
  const capture = new AuthorizedHostEventCaptureService(
    hostEvents,
    personas,
    ambient,
    new ContinuityConversationTurnAdapter(options.host.identity),
  );
  const lifecycle = new ContinuityConversationClientCoordinator(
    new ContinuityConversationService(
      conversations,
      personas,
      new ContinuityLexicalContextService(continuityMemories),
      options.host,
      capture,
      {
        behaviorProfiles: new ContinuityPersonaBehaviorService(
          new SqliteContinuityPersonaBehaviorRepository(options.database),
        ),
        ...(options.now === undefined ? {} : { now: options.now }),
      },
    ),
  );
  const authorizations = new ContinuityConversationAuthorizationService(
    new HostAuthorizationService(hostEvents, personas),
    options.grantStore,
  );
  const client = new ContinuityConversationProtectedClient({
    authorizations,
    conversations,
    lifecycle,
    personas,
  });
  const hostDeletion = new ContinuityConversationHostDeletionService(
    conversations,
    options.host,
    {
      leaveConversation: (conversationId, personaId) =>
        client.leaveConversation(conversationId, personaId),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  let closed = false;

  return {
    authorizations,
    client,
    hostDeletion,
    hostIdentity: { ...options.host.identity },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await options.host.close();
    },
  };
}

export function createWindowsCodexContinuityConversationRuntime(
  options: WindowsCodexContinuityConversationRuntimeOptions,
): ContinuityConversationRuntime {
  const host = new CodexAppServerConversationHost({
    ...options.hostOptions,
    workingDirectory: options.workingDirectory,
  });
  return createContinuityConversationRuntime({
    database: options.database,
    extractionModel: options.extractionModel,
    grantStore: new WindowsDpapiConversationGrantStore({ bridge: options.bridge }),
    host,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sensitivityClassifier === undefined
      ? {}
      : { sensitivityClassifier: options.sensitivityClassifier }),
  });
}
