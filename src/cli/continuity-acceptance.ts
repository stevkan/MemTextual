#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { verifyWindowsContinuityBundle } from "../packaging/windows-continuity-bundle.js";
import {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentPlan,
} from "../platform/windows-continuity-deployment.js";
import { previewWindowsHostInstallation } from "../platform/windows-host-integration.js";
import {
  WindowsPowerShellHostOperations,
  createWindowsPowerShellBridge,
} from "../platform/windows-powershell-host-operations.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { resolveContinuityConversationConfiguration } from "../runtime/continuity-conversation-configuration.js";
import {
  verifyContinuityDatabaseAcceptance,
  verifyContinuityHostAcceptance,
} from "../services/continuity-installation-acceptance-service.js";

export interface ContinuityAcceptanceCliArguments {
  conversationConfigurationPath: string;
  personaId: string;
  trustedFingerprint: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-acceptance --persona PERSONA_ID --conversation-config PATH --trusted-fingerprint SHA256",
    "",
    "This command is read-only. It verifies the staged signed bundle, installed",
    "host identity and schedules, current database schema and integrity, and",
    "the selected persona and conversation configuration.",
  ].join("\n");
}

export function parseContinuityAcceptanceCliArguments(
  argv: readonly string[],
): ContinuityAcceptanceCliArguments {
  const allowed = new Set([
    "--conversation-config",
    "--persona",
    "--trusted-fingerprint",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  const conversationConfigurationPath = values.get("--conversation-config")?.trim();
  const personaId = values.get("--persona")?.trim();
  const trustedFingerprint = values.get("--trusted-fingerprint")?.trim();
  if (
    conversationConfigurationPath === undefined ||
    conversationConfigurationPath.length === 0 ||
    personaId === undefined ||
    personaId.length === 0 ||
    trustedFingerprint === undefined ||
    trustedFingerprint.length === 0
  ) {
    throw new Error(`All three options are required.\n\n${usage()}`);
  }
  return { conversationConfigurationPath, personaId, trustedFingerprint };
}

export async function runContinuityAcceptanceCli(
  argv: readonly string[],
): Promise<unknown> {
  if (process.platform !== "win32") {
    throw new Error("Continuity installation acceptance currently requires Windows.");
  }
  const arguments_ = parseContinuityAcceptanceCliArguments(argv);
  const conversation = resolveContinuityConversationConfiguration(
    arguments_.conversationConfigurationPath,
  );
  const deployment = loadWindowsContinuityDeploymentConfiguration(
    conversation.deploymentConfigurationPath,
  );
  const plan = createWindowsContinuityDeploymentPlan(deployment);
  validateWindowsContinuityDeploymentPlan(plan);

  const bundle = await verifyWindowsContinuityBundle({
    bundleDirectory: deployment.applicationDirectory,
    trustedCertificateFingerprint256: arguments_.trustedFingerprint,
  });
  const operations = new WindowsPowerShellHostOperations({
    bridge: createWindowsPowerShellBridge({
      scriptPath: plan.executorScriptPath,
      stateDirectory: deployment.stateDirectory,
    }),
  });
  const host = verifyContinuityHostAcceptance(
    await previewWindowsHostInstallation(operations, plan.host),
  );

  const database = openMemTextualDatabase({
    filename: conversation.databasePath,
    readonly: true,
  });
  try {
    const data = verifyContinuityDatabaseAcceptance({
      database,
      migrationsDirectory: conversation.migrationsDirectory,
      personaId: arguments_.personaId,
      personas: new SqlitePersonaRepository(database),
    });
    return {
      accepted: true,
      bundle: {
        manifestSha256: bundle.manifestSha256,
        packageVersion: bundle.manifest.packageVersion,
        publisherTrusted: bundle.publisherTrusted,
      },
      conversation: {
        adapterId: conversation.adapterId,
        extractionModel: conversation.extractionModel,
      },
      data,
      host,
    };
  } finally {
    database.close();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runContinuityAcceptanceCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown acceptance error";
      process.stderr.write(`MemTextual Continuity acceptance failed: ${message}\n`);
      process.exitCode = 1;
    });
}
