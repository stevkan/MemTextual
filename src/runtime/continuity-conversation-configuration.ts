import { lstatSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
import {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
} from "../platform/windows-continuity-deployment.js";

export const continuityConversationConfigurationFormatVersion = 1 as const;

export interface ContinuityConversationConfiguration {
  adapterId: "codex-app-server-windows";
  deploymentConfigurationPath: string;
  extractionModel: string;
  formatVersion: typeof continuityConversationConfigurationFormatVersion;
  workingDirectory: string;
}

export interface ResolvedContinuityConversationConfiguration
  extends ContinuityConversationConfiguration {
  databasePath: string;
  executorScriptPath: string;
  migrationsDirectory: string;
  stateDirectory: string;
}

const configurationKeys = new Set([
  "adapterId",
  "deploymentConfigurationPath",
  "extractionModel",
  "formatVersion",
  "workingDirectory",
]);

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Continuity conversation configuration must be an object.");
  }
  return value as Record<string, unknown>;
}

function absoluteWindowsPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    !win32.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a non-empty absolute Windows path.`);
  }
  return win32.resolve(value);
}

function directPath(
  path: string,
  kind: "directory" | "file",
  label: string,
): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}.`);
  }
  if (
    stats.isSymbolicLink() ||
    (kind === "directory" ? !stats.isDirectory() : !stats.isFile())
  ) {
    throw new Error(`${label} must be a direct ${kind}: ${path}.`);
  }
}

function sameWindowsPath(left: string, right: string): boolean {
  return win32.resolve(left).toLocaleLowerCase("en-US") ===
    win32.resolve(right).toLocaleLowerCase("en-US");
}

export function assertContinuityConversationDatabasePath(
  configuration: Pick<ResolvedContinuityConversationConfiguration, "databasePath">,
  selectedDatabasePath: string,
): void {
  if (!sameWindowsPath(selectedDatabasePath, configuration.databasePath)) {
    throw new Error(
      "The selected database does not match the Windows Continuity deployment database.",
    );
  }
}

export function assertContinuityConversationMigrationsPath(
  configuration: Pick<
    ResolvedContinuityConversationConfiguration,
    "migrationsDirectory"
  >,
  selectedMigrationsDirectory: string,
): void {
  if (
    !sameWindowsPath(
      selectedMigrationsDirectory,
      configuration.migrationsDirectory,
    )
  ) {
    throw new Error(
      "The selected migrations directory does not match the Windows Continuity deployment application.",
    );
  }
}

export function parseContinuityConversationConfiguration(
  value: unknown,
): ContinuityConversationConfiguration {
  const record = requireRecord(value);
  const unexpected = Object.keys(record).filter(
    (key) => !configurationKeys.has(key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Continuity conversation configuration contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (
    record.formatVersion !== continuityConversationConfigurationFormatVersion
  ) {
    throw new Error(
      `Continuity conversation configuration formatVersion must be ${continuityConversationConfigurationFormatVersion}.`,
    );
  }
  if (record.adapterId !== "codex-app-server-windows") {
    throw new Error(
      "Continuity conversation adapterId must be codex-app-server-windows.",
    );
  }
  if (
    typeof record.extractionModel !== "string" ||
    record.extractionModel.length === 0 ||
    record.extractionModel !== record.extractionModel.trim() ||
    record.extractionModel.length > 180 ||
    /[\u0000-\u001f\u007f]/u.test(record.extractionModel)
  ) {
    throw new Error(
      "Continuity conversation extractionModel must be 1 through 180 trimmed characters without control characters.",
    );
  }
  return {
    adapterId: "codex-app-server-windows",
    deploymentConfigurationPath: absoluteWindowsPath(
      record.deploymentConfigurationPath,
      "Continuity conversation deploymentConfigurationPath",
    ),
    extractionModel: record.extractionModel,
    formatVersion: continuityConversationConfigurationFormatVersion,
    workingDirectory: absoluteWindowsPath(
      record.workingDirectory,
      "Continuity conversation workingDirectory",
    ),
  };
}

export function loadContinuityConversationConfiguration(
  configurationPath: string,
): ContinuityConversationConfiguration {
  const path = win32.resolve(configurationPath);
  directPath(path, "file", "Continuity conversation configuration");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Continuity conversation configuration is not valid JSON.");
  }
  return parseContinuityConversationConfiguration(value);
}

export function resolveContinuityConversationConfiguration(
  configurationPath: string,
  selectedDatabasePath?: string,
): ResolvedContinuityConversationConfiguration {
  if (process.platform !== "win32") {
    throw new Error(
      "The codex-app-server-windows conversation adapter requires Windows.",
    );
  }
  const configuration = loadContinuityConversationConfiguration(
    configurationPath,
  );
  const deployment = loadWindowsContinuityDeploymentConfiguration(
    configuration.deploymentConfigurationPath,
  );
  const plan = createWindowsContinuityDeploymentPlan(deployment);
  const migrationsDirectory = win32.join(
    deployment.applicationDirectory,
    "migrations",
  );
  if (selectedDatabasePath !== undefined) {
    assertContinuityConversationDatabasePath(
      { databasePath: deployment.databasePath },
      selectedDatabasePath,
    );
  }
  directPath(
    deployment.databasePath,
    "file",
    "Continuity conversation database",
  );
  directPath(
    configuration.workingDirectory,
    "directory",
    "Continuity conversation working directory",
  );
  directPath(
    plan.executorScriptPath,
    "file",
    "Continuity conversation host executor script",
  );
  directPath(
    migrationsDirectory,
    "directory",
    "Continuity conversation migrations directory",
  );
  return {
    ...configuration,
    databasePath: deployment.databasePath,
    executorScriptPath: plan.executorScriptPath,
    migrationsDirectory,
    stateDirectory: deployment.stateDirectory,
  };
}
