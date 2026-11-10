import type { OAuthMetadata } from "@modelcontextprotocol/server";
import type Database from "better-sqlite3";
import { Auth0AccessTokenVerifier, Auth0VerifiedIdentityExtractor } from "../mcp/auth0-access-token-verifier.js";
import { ContinuityBoundMcpPrincipalResolver } from "../mcp/continuity-bound-principal-resolver.js";
import {
  continuityRemoteResourceServerUrl,
  type ContinuityRemoteConfiguration,
} from "../configuration/continuity-remote-configuration.js";
import { createContinuityMcpHttpApplication } from "../mcp/continuity-http.js";
import {
  startContinuityNodeHttpListener,
  type ContinuityNodeHttpListener,
  type ContinuityNodeHttpListenerOptions,
} from "../mcp/continuity-node-http-listener.js";
import { TrustedOAuthClientExplicitActionPolicy } from "../mcp/trusted-oauth-client-explicit-action-policy.js";
import type { CodexAppServerStructuredTaskRunner } from "../providers/codex-app-server-ambient-extraction-provider.js";
import { CodexAppServerExplicitSensitivityAssessor } from "../providers/codex-app-server-explicit-sensitivity-assessor.js";
import { SqliteContinuityControlRepository } from "../repositories/sqlite-continuity-control-repository.js";
import { SqliteContinuityIdentityBindingRepository } from "../repositories/sqlite-continuity-identity-binding-repository.js";
import { SqliteContinuityMemoryRepository } from "../repositories/sqlite-continuity-memory-repository.js";
import { SqliteContinuityPersonaBehaviorRepository } from "../repositories/sqlite-continuity-persona-behavior-repository.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { ContinuityAuthenticatedPersonaService } from "../services/continuity-authenticated-persona-service.js";
import { ContinuityControlService } from "../services/continuity-control-service.js";
import { ContinuityIdentityBindingService } from "../services/continuity-identity-binding-service.js";
import { ContinuityMemoryService } from "../services/continuity-memory-service.js";
import { ContinuityPersonaBehaviorService } from "../services/continuity-persona-behavior-service.js";
import { IngestionService } from "../services/ingestion-service.js";
import { MemoryService } from "../services/memory-service.js";
import { PersonaService } from "../services/persona-service.js";

export interface ContinuityRemoteSensitivityRunner
  extends CodexAppServerStructuredTaskRunner {
  close(): Promise<void>;
}

export interface StartContinuityRemoteRuntimeOptions {
  configuration: ContinuityRemoteConfiguration;
  database: Database.Database;
  oauthMetadata: OAuthMetadata;
  sensitivityModel: string;
  sensitivityRunner: ContinuityRemoteSensitivityRunner;
  startListener?: (
    options: ContinuityNodeHttpListenerOptions,
  ) => Promise<ContinuityNodeHttpListener>;
}

export interface ContinuityRemoteRuntime {
  localOrigin: string;
  resourceServerUrl: URL;
  close(): Promise<void>;
}

function explicitActionPolicy(configuration: ContinuityRemoteConfiguration) {
  const authorization = configuration.writeAuthorization;
  return authorization.mode === "deny"
    ? { authorize: () => false }
    : new TrustedOAuthClientExplicitActionPolicy({
        trustedClientIds: authorization.trustedClientIds,
      });
}

async function closeAll(
  operations: readonly (() => void | Promise<void>)[],
): Promise<void> {
  let firstError: unknown;
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

export async function startContinuityRemoteRuntime(
  options: StartContinuityRemoteRuntimeOptions,
): Promise<ContinuityRemoteRuntime> {
  const resourceServerUrl = continuityRemoteResourceServerUrl(
    options.configuration,
  );
  const memoryRepository = new SqliteMemoryRepository(options.database);
  const personaRepository = new SqlitePersonaRepository(options.database);
  const personaService = new PersonaService(personaRepository);
  const memories = new MemoryService(memoryRepository);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(options.database, memoryRepository),
  );
  const continuityMemories = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(options.database, memoryRepository),
  );
  const bindings = new ContinuityIdentityBindingService(
    new SqliteContinuityIdentityBindingRepository(options.database),
    personaService,
  );
  const application = createContinuityMcpHttpApplication({
    oauthMetadata: options.oauthMetadata,
    resourceServerUrl,
    tokenVerifier: new Auth0AccessTokenVerifier({
      issuer: options.configuration.auth0Issuer,
      resourceServerUrl,
    }),
    principalResolver: new ContinuityBoundMcpPrincipalResolver(
      bindings,
      new Auth0VerifiedIdentityExtractor(options.configuration.auth0Issuer),
    ),
    explicitUserActionPolicy: explicitActionPolicy(options.configuration),
    services: {
      personas: new ContinuityAuthenticatedPersonaService(personaService),
      behaviors: new ContinuityPersonaBehaviorService(
        new SqliteContinuityPersonaBehaviorRepository(options.database),
      ),
      control: new ContinuityControlService(
        new SqliteContinuityControlRepository(options.database),
        personaRepository,
        continuityMemories,
        memories,
        ingestion,
      ),
      memories: continuityMemories,
      sensitivity: new CodexAppServerExplicitSensitivityAssessor(
        options.sensitivityRunner,
        { model: options.sensitivityModel },
      ),
    },
  });
  const startListener = options.startListener ?? startContinuityNodeHttpListener;
  let listener: ContinuityNodeHttpListener;
  try {
    listener = await startListener({
      application,
      publicOrigin: new URL(options.configuration.publicOrigin),
      port: options.configuration.port,
    });
  } catch (error) {
    await closeAll([
      () => application.close(),
      () => options.sensitivityRunner.close(),
    ]).catch(() => undefined);
    throw error;
  }
  let closed = false;
  return {
    localOrigin: listener.localOrigin,
    resourceServerUrl,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await closeAll([
        () => listener.close(),
        () => application.close(),
        () => options.sensitivityRunner.close(),
      ]);
    },
  };
}
