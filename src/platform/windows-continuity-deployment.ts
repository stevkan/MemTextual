import { lstatSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
import { loadAzureCertificateCredentialConfiguration } from "../credentials/azure-certificate-credential.js";
import { loadReplicationDestinationConfiguration } from "../safeguards/replication-destination-config.js";
import type { HostScheduleDefinition } from "./host-platform.js";
import type {
  WindowsHostIntegrationConfiguration,
  WindowsProtectedPath,
} from "./windows-host-integration.js";

export const windowsContinuityDeploymentFormatVersion = 1 as const;

export interface WindowsContinuityOffsiteDeployment {
  credentialConfigurationPath?: string;
  destinationConfigurationPath: string;
  intervalHours: number;
  keyEnvironmentVariable: string;
  keyId: string;
  pollIntervalMinutes: number;
}

export interface WindowsContinuityDeploymentConfiguration {
  applicationDirectory: string;
  backupDirectory: string;
  backupIntervalHours: number;
  backupPollIntervalMinutes: number;
  databasePath: string;
  formatVersion: typeof windowsContinuityDeploymentFormatVersion;
  identityName: string;
  offsite?: WindowsContinuityOffsiteDeployment;
  stateDirectory: string;
}

export interface WindowsContinuityDeploymentPlan {
  deployment: WindowsContinuityDeploymentConfiguration;
  executorScriptPath: string;
  host: WindowsHostIntegrationConfiguration;
  nodeExecutablePath: string;
  safeguardScriptPath: string;
}

const rootKeys = new Set([
  "applicationDirectory",
  "backupDirectory",
  "backupIntervalHours",
  "backupPollIntervalMinutes",
  "databasePath",
  "formatVersion",
  "identityName",
  "offsite",
  "stateDirectory",
]);

const offsiteKeys = new Set([
  "credentialConfigurationPath",
  "destinationConfigurationPath",
  "intervalHours",
  "keyEnvironmentVariable",
  "keyId",
  "pollIntervalMinutes",
]);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnexpected(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function absolutePath(value: unknown, label: string): string {
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

function finiteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} must be from ${minimum} through ${maximum}.`);
  }
  return value;
}

function pollInterval(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 5 ||
    value > 1_440
  ) {
    throw new Error(`${label} must be an integer from 5 through 1440.`);
  }
  return value;
}

function safeIdentifier(value: unknown, label: string, maximum = 128): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function environmentName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
  ) {
    throw new Error(
      "Windows Continuity offsite keyEnvironmentVariable must name one environment variable.",
    );
  }
  return value;
}

function parseOffsite(value: unknown): WindowsContinuityOffsiteDeployment {
  const record = requireRecord(
    value,
    "Windows Continuity offsite configuration",
  );
  rejectUnexpected(
    record,
    offsiteKeys,
    "Windows Continuity offsite configuration",
  );
  const credentialConfigurationPath =
    record.credentialConfigurationPath === undefined
      ? undefined
      : absolutePath(
          record.credentialConfigurationPath,
          "Windows Continuity credentialConfigurationPath",
        );
  return {
    destinationConfigurationPath: absolutePath(
      record.destinationConfigurationPath,
      "Windows Continuity destinationConfigurationPath",
    ),
    intervalHours: finiteNumber(
      record.intervalHours,
      "Windows Continuity offsite intervalHours",
      1 / 12,
      8_760,
    ),
    keyEnvironmentVariable: environmentName(record.keyEnvironmentVariable),
    keyId: safeIdentifier(
      record.keyId,
      "Windows Continuity offsite keyId",
    ),
    pollIntervalMinutes: pollInterval(
      record.pollIntervalMinutes,
      "Windows Continuity offsite pollIntervalMinutes",
    ),
    ...(credentialConfigurationPath === undefined
      ? {}
      : { credentialConfigurationPath }),
  };
}

export function parseWindowsContinuityDeploymentConfiguration(
  value: unknown,
): WindowsContinuityDeploymentConfiguration {
  const record = requireRecord(
    value,
    "Windows Continuity deployment configuration",
  );
  rejectUnexpected(
    record,
    rootKeys,
    "Windows Continuity deployment configuration",
  );
  if (record.formatVersion !== windowsContinuityDeploymentFormatVersion) {
    throw new Error(
      `Windows Continuity deployment formatVersion must be ${windowsContinuityDeploymentFormatVersion}.`,
    );
  }
  return {
    applicationDirectory: absolutePath(
      record.applicationDirectory,
      "Windows Continuity applicationDirectory",
    ),
    backupDirectory: absolutePath(
      record.backupDirectory,
      "Windows Continuity backupDirectory",
    ),
    backupIntervalHours: finiteNumber(
      record.backupIntervalHours,
      "Windows Continuity backupIntervalHours",
      1 / 12,
      24,
    ),
    backupPollIntervalMinutes: pollInterval(
      record.backupPollIntervalMinutes,
      "Windows Continuity backupPollIntervalMinutes",
    ),
    databasePath: absolutePath(
      record.databasePath,
      "Windows Continuity databasePath",
    ),
    formatVersion: windowsContinuityDeploymentFormatVersion,
    identityName: safeIdentifier(
      record.identityName,
      "Windows Continuity identityName",
      20,
    ),
    stateDirectory: absolutePath(
      record.stateDirectory,
      "Windows Continuity stateDirectory",
    ),
    ...(record.offsite === undefined
      ? {}
      : { offsite: parseOffsite(record.offsite) }),
  };
}

export function loadWindowsContinuityDeploymentConfiguration(
  configurationPath: string,
): WindowsContinuityDeploymentConfiguration {
  const path = win32.resolve(configurationPath);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error("Windows Continuity deployment configuration does not exist.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Windows Continuity deployment configuration must be a direct regular file.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Windows Continuity deployment configuration is not valid JSON.",
    );
  }
  return parseWindowsContinuityDeploymentConfiguration(value);
}

function existingDirectPath(
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

function numberArgument(value: number): string {
  return String(value);
}

export function createWindowsContinuityDeploymentPlan(
  configuration: WindowsContinuityDeploymentConfiguration,
): WindowsContinuityDeploymentPlan {
  const deployment = parseWindowsContinuityDeploymentConfiguration(configuration);
  const executorScriptPath = win32.join(
    deployment.applicationDirectory,
    "scripts",
    "windows-host-executor.ps1",
  );
  const nodeExecutablePath = win32.join(
    deployment.applicationDirectory,
    "runtime",
    "node.exe",
  );
  const safeguardScriptPath = win32.join(
    deployment.applicationDirectory,
    "dist",
    "src",
    "cli",
    "safeguard.js",
  );
  const protectedPaths: WindowsProtectedPath[] = [
    { access: "read", mode: "grant", path: deployment.applicationDirectory },
    {
      access: "modify",
      mode: "grant",
      path: win32.dirname(deployment.databasePath),
    },
    { access: "modify", mode: "grant", path: deployment.backupDirectory },
  ];
  const schedules: HostScheduleDefinition[] = [
    {
      command: {
        arguments: [
          safeguardScriptPath,
          "run-if-due",
          "--database",
          deployment.databasePath,
          "--output",
          deployment.backupDirectory,
          "--interval-hours",
          numberArgument(deployment.backupIntervalHours),
        ],
        environmentVariableNames: [],
        executablePath: nodeExecutablePath,
        workingDirectory: deployment.applicationDirectory,
      },
      intervalMinutes: deployment.backupPollIntervalMinutes,
      scheduleId: "MemTextual-Backup",
    },
  ];
  if (deployment.offsite !== undefined) {
    const destination = loadReplicationDestinationConfiguration(
      deployment.offsite.destinationConfigurationPath,
    );
    protectedPaths.push({
      access: "read",
      mode: "grant",
      path: deployment.offsite.destinationConfigurationPath,
    });
    const arguments_ = [
      safeguardScriptPath,
      "offsite-run-if-due",
      "--database",
      deployment.databasePath,
      "--source",
      deployment.backupDirectory,
      "--destination-config",
      deployment.offsite.destinationConfigurationPath,
    ];
    if (destination.adapterId === "local-directory") {
      if (deployment.offsite.credentialConfigurationPath !== undefined) {
        throw new Error(
          "Local-directory offsite deployment must not include credentialConfigurationPath.",
        );
      }
      protectedPaths.push({
        access: "modify",
        mode: "grant",
        path: destination.destinationDirectory,
      });
    } else {
      const credentialConfigurationPath =
        deployment.offsite.credentialConfigurationPath;
      if (credentialConfigurationPath === undefined) {
        throw new Error(
          "Azure Blob offsite deployment requires credentialConfigurationPath.",
        );
      }
      const credential = loadAzureCertificateCredentialConfiguration(
        credentialConfigurationPath,
      );
      if (credential.credentialId !== destination.credentialId) {
        throw new Error(
          "Azure destination and certificate credential IDs do not match.",
        );
      }
      protectedPaths.push(
        {
          access: "read",
          mode: "grant",
          path: credentialConfigurationPath,
        },
        {
          access: "read",
          mode: "restrict",
          path: credential.certificatePath,
        },
      );
      arguments_.push("--credential-config", credentialConfigurationPath);
    }
    arguments_.push(
      "--interval-hours",
      numberArgument(deployment.offsite.intervalHours),
      "--key-env",
      deployment.offsite.keyEnvironmentVariable,
      "--key-id",
      deployment.offsite.keyId,
    );
    schedules.push({
      command: {
        arguments: arguments_,
        environmentVariableNames: [
          deployment.offsite.keyEnvironmentVariable,
        ],
        executablePath: nodeExecutablePath,
        workingDirectory: deployment.applicationDirectory,
      },
      intervalMinutes: deployment.offsite.pollIntervalMinutes,
      scheduleId: "MemTextual-Offsite",
    });
  }
  return {
    deployment,
    executorScriptPath,
    host: {
      formatVersion: 1,
      identity: {
        identityName: deployment.identityName,
        purpose:
          "Run MemTextual Continuity backup and encrypted replication tasks.",
      },
      protectedPaths,
      schedules,
    },
    nodeExecutablePath,
    safeguardScriptPath,
  };
}

export function validateWindowsContinuityDeploymentPlan(
  plan: WindowsContinuityDeploymentPlan,
): void {
  existingDirectPath(
    plan.deployment.applicationDirectory,
    "directory",
    "Windows Continuity application directory",
  );
  existingDirectPath(
    win32.dirname(plan.deployment.databasePath),
    "directory",
    "Windows Continuity database directory",
  );
  existingDirectPath(
    plan.deployment.databasePath,
    "file",
    "Windows Continuity database",
  );
  existingDirectPath(
    plan.deployment.backupDirectory,
    "directory",
    "Windows Continuity backup directory",
  );
  let stateStats;
  try {
    stateStats = lstatSync(plan.deployment.stateDirectory);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  if (stateStats === undefined) {
    existingDirectPath(
      win32.dirname(plan.deployment.stateDirectory),
      "directory",
      "Windows Continuity host state parent directory",
    );
  } else if (!stateStats.isDirectory() || stateStats.isSymbolicLink()) {
    throw new Error(
      `Windows Continuity host state directory must be a direct directory: ${plan.deployment.stateDirectory}.`,
    );
  }
  existingDirectPath(
    plan.executorScriptPath,
    "file",
    "Windows host executor script",
  );
  existingDirectPath(
    plan.nodeExecutablePath,
    "file",
    "Windows Continuity Node runtime",
  );
  existingDirectPath(
    plan.safeguardScriptPath,
    "file",
    "Windows Continuity safeguard entry point",
  );
  for (const entry of plan.host.protectedPaths) {
    existingDirectPath(
      entry.path,
      lstatSync(entry.path).isDirectory() ? "directory" : "file",
      "Windows Continuity protected path",
    );
  }
}

export function validateWindowsContinuityDeploymentEnvironment(
  plan: WindowsContinuityDeploymentPlan,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const name = plan.deployment.offsite?.keyEnvironmentVariable;
  if (name === undefined) return;
  const encoded = environment[name]?.trim();
  if (
    encoded === undefined ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  ) {
    throw new Error(
      `Windows Continuity recovery-key environment variable is missing or not canonical base64: ${name}.`,
    );
  }
  const key = Buffer.from(encoded, "base64");
  try {
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(
        `Windows Continuity recovery-key environment variable must encode exactly 32 bytes: ${name}.`,
      );
    }
  } finally {
    key.fill(0);
  }
}
