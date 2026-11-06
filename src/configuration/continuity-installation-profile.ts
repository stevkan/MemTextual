import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, win32 } from "node:path";
import {
  parseWindowsContinuityDeploymentConfiguration,
  type WindowsContinuityDeploymentConfiguration,
} from "../platform/windows-continuity-deployment.js";
import {
  parseContinuityConversationConfiguration,
  type ContinuityConversationConfiguration,
} from "../runtime/continuity-conversation-configuration.js";

export const continuityInstallationProfileFormatVersion = 1 as const;

export interface ContinuityInstallationPaths {
  applicationDirectory: string;
  backupDirectory: string;
  conversationConfigurationPath: string;
  dataRoot: string;
  databasePath: string;
  deploymentConfigurationPath: string;
  installationProfilePath: string;
  migrationsDirectory: string;
  stateDirectory: string;
  workingDirectory: string;
}

export interface ContinuityInstallationProfile extends ContinuityInstallationPaths {
  formatVersion: typeof continuityInstallationProfileFormatVersion;
  personaId: string;
  userId: string;
}

const profileKeys = new Set([
  "applicationDirectory", "backupDirectory", "conversationConfigurationPath",
  "dataRoot", "databasePath", "deploymentConfigurationPath", "formatVersion",
  "installationProfilePath", "migrationsDirectory", "personaId",
  "stateDirectory", "userId", "workingDirectory",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function absolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value !== value.trim() || !win32.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a non-empty absolute Windows path.`);
  }
  return win32.resolve(value);
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be 1 through 128 trimmed characters without control characters.`);
  }
  return value;
}

export function defaultContinuityDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const programData = environment.ProgramData ?? environment.PROGRAMDATA;
  return win32.join(programData?.trim() || "C:\\ProgramData", "MemTextual Continuity");
}

export function resolveContinuityInstallationPaths(input: {
  applicationDirectory: string;
  backupDirectory?: string;
  dataRoot?: string;
}): ContinuityInstallationPaths {
  const applicationDirectory = win32.resolve(input.applicationDirectory);
  const dataRoot = win32.resolve(input.dataRoot ?? defaultContinuityDataRoot());
  return {
    applicationDirectory,
    backupDirectory: win32.resolve(input.backupDirectory ?? win32.join(dataRoot, "backups")),
    conversationConfigurationPath: win32.join(dataRoot, "conversation.json"),
    dataRoot,
    databasePath: win32.join(dataRoot, "data", "memtextual.db"),
    deploymentConfigurationPath: win32.join(dataRoot, "deployment.json"),
    installationProfilePath: win32.join(dataRoot, "installation.json"),
    migrationsDirectory: win32.join(applicationDirectory, "migrations"),
    stateDirectory: win32.join(dataRoot, "host-state"),
    workingDirectory: win32.join(dataRoot, "conversations"),
  };
}

export function createContinuityInstallationConfiguration(input: {
  applicationDirectory: string;
  backupDirectory?: string;
  dataRoot?: string;
  extractionModel: string;
  identityName?: string;
}): {
  conversation: ContinuityConversationConfiguration;
  deployment: WindowsContinuityDeploymentConfiguration;
  paths: ContinuityInstallationPaths;
} {
  const paths = resolveContinuityInstallationPaths(input);
  const deployment = parseWindowsContinuityDeploymentConfiguration({
    applicationDirectory: paths.applicationDirectory,
    backupDirectory: paths.backupDirectory,
    backupIntervalHours: 24,
    backupPollIntervalMinutes: 60,
    databasePath: paths.databasePath,
    formatVersion: 1,
    identityName: input.identityName ?? "MemTextualSvc",
    stateDirectory: paths.stateDirectory,
  });
  const conversation = parseContinuityConversationConfiguration({
    adapterId: "codex-app-server-windows",
    deploymentConfigurationPath: paths.deploymentConfigurationPath,
    extractionModel: input.extractionModel,
    formatVersion: 1,
    workingDirectory: paths.workingDirectory,
  });
  return { conversation, deployment, paths };
}

function readDirectJson(path: string, label: string): unknown {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function assertCompatibleManagedJson(
  path: string,
  value: unknown,
  label: string,
): void {
  if (existsSync(path) && json(readDirectJson(path, label)) !== json(value)) {
    throw new Error(`${label} already exists with different settings: ${path}.`);
  }
}

export function writeManagedJson(path: string, value: unknown, label: string): void {
  assertCompatibleManagedJson(path, value, label);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json(value), { encoding: "utf8", flag: "wx" });
  }
}

export function createContinuityInstallationDirectories(
  paths: ContinuityInstallationPaths,
): void {
  for (const path of [
    dirname(paths.databasePath), paths.backupDirectory,
    paths.stateDirectory, paths.workingDirectory,
  ]) {
    mkdirSync(path, { recursive: true });
  }
}

export function parseContinuityInstallationProfile(
  value: unknown,
): ContinuityInstallationProfile {
  const input = record(value, "Continuity installation profile");
  const unexpected = Object.keys(input).filter((key) => !profileKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Continuity installation profile contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (input.formatVersion !== continuityInstallationProfileFormatVersion) {
    throw new Error(
      `Continuity installation profile formatVersion must be ${continuityInstallationProfileFormatVersion}.`,
    );
  }
  return {
    applicationDirectory: absolutePath(input.applicationDirectory, "applicationDirectory"),
    backupDirectory: absolutePath(input.backupDirectory, "backupDirectory"),
    conversationConfigurationPath: absolutePath(
      input.conversationConfigurationPath, "conversationConfigurationPath",
    ),
    dataRoot: absolutePath(input.dataRoot, "dataRoot"),
    databasePath: absolutePath(input.databasePath, "databasePath"),
    deploymentConfigurationPath: absolutePath(
      input.deploymentConfigurationPath, "deploymentConfigurationPath",
    ),
    formatVersion: continuityInstallationProfileFormatVersion,
    installationProfilePath: absolutePath(
      input.installationProfilePath, "installationProfilePath",
    ),
    migrationsDirectory: absolutePath(input.migrationsDirectory, "migrationsDirectory"),
    personaId: identifier(input.personaId, "personaId"),
    stateDirectory: absolutePath(input.stateDirectory, "stateDirectory"),
    userId: identifier(input.userId, "userId"),
    workingDirectory: absolutePath(input.workingDirectory, "workingDirectory"),
  };
}

export function loadContinuityInstallationProfile(
  profilePath = win32.join(defaultContinuityDataRoot(), "installation.json"),
): ContinuityInstallationProfile {
  return parseContinuityInstallationProfile(
    readDirectJson(resolve(profilePath), "Continuity installation profile"),
  );
}
