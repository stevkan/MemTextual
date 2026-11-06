import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, win32 } from "node:path";
import { homedir } from "node:os";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { createDatabaseSnapshot } from "../safeguards/database-safeguard.js";
import { writeManagedJson } from "./continuity-installation-profile.js";

export const developerInstallationProfileFormatVersion = 1 as const;

export interface DeveloperInstallationProfile {
  applicationDirectory: string;
  backupDirectory: string;
  dataRoot: string;
  databasePath: string;
  formatVersion: typeof developerInstallationProfileFormatVersion;
  installationProfilePath: string;
  mcpScriptPath: string;
  migrationsDirectory: string;
  nodeExecutablePath: string;
  serverName: string;
}

export interface DeveloperInstallationResult {
  created: boolean;
  databaseCreated: boolean;
  profile: DeveloperInstallationProfile;
  snapshotPath?: string;
}

const profileKeys = new Set([
  "applicationDirectory", "backupDirectory", "dataRoot", "databasePath",
  "formatVersion", "installationProfilePath", "mcpScriptPath",
  "migrationsDirectory", "nodeExecutablePath", "serverName",
]);

function directPath(path: string, kind: "directory" | "file", label: string): void {
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
function isWithin(parent: string, child: string): boolean {
  const path = win32.relative(parent, child);
  return path === "" || (!path.startsWith("..") && !win32.isAbsolute(path));
}

function validateBackupLocation(
  databasePath: string,
  backupDirectory: string,
): void {
  const databaseDirectory = win32.dirname(databasePath);
  if (databaseDirectory === backupDirectory) {
    throw new Error(
      "The Developer backup directory must differ from the active database directory.",
    );
  }
  if (isWithin(backupDirectory, databasePath)) {
    throw new Error(
      "The active database may not be stored inside its Developer backup directory.",
    );
  }
  if (isWithin(databaseDirectory, backupDirectory)) {
    throw new Error(
      "The Developer backup directory may not be stored inside the active database directory.",
    );
  }
}


function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Developer installation profile must be an object.");
  }
  return value as Record<string, unknown>;
}

function pathValue(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value !== value.trim() || !win32.isAbsolute(value)
  ) {
    throw new Error(`Developer installation ${label} must be an absolute Windows path.`);
  }
  return win32.resolve(value);
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)
  ) {
    throw new Error(`Developer installation ${label} is invalid.`);
  }
  return value;
}

export function defaultDeveloperDataRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const localAppData = environment.LOCALAPPDATA?.trim();
  return win32.join(
    localAppData || win32.join(homedir(), "AppData", "Local"),
    "MemTextual Developer",
  );
}

export function createDeveloperInstallationProfile(input: {
  applicationDirectory: string;
  backupDirectory?: string;
  dataRoot?: string;
  databasePath?: string;
  nodeExecutablePath?: string;
  serverName?: string;
}): DeveloperInstallationProfile {
  const applicationDirectory = win32.resolve(input.applicationDirectory);
  const dataRoot = win32.resolve(input.dataRoot ?? defaultDeveloperDataRoot());
  return parseDeveloperInstallationProfile({
    applicationDirectory,
    backupDirectory: win32.resolve(
      input.backupDirectory ?? win32.join(dataRoot, "backups"),
    ),
    dataRoot,
    databasePath: win32.resolve(
      input.databasePath ?? win32.join(dataRoot, "data", "memtextual.db"),
    ),
    formatVersion: developerInstallationProfileFormatVersion,
    installationProfilePath: win32.join(dataRoot, "installation.json"),
    mcpScriptPath: win32.join(applicationDirectory, "dist", "src", "mcp", "stdio.js"),
    migrationsDirectory: win32.join(applicationDirectory, "migrations"),
    nodeExecutablePath: win32.resolve(input.nodeExecutablePath ?? process.execPath),
    serverName: input.serverName ?? "memtextual",
  });
}

export function parseDeveloperInstallationProfile(
  value: unknown,
): DeveloperInstallationProfile {
  const input = record(value);
  const unexpected = Object.keys(input).filter((key) => !profileKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Developer installation profile contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (input.formatVersion !== developerInstallationProfileFormatVersion) {
    throw new Error(
      `Developer installation profile formatVersion must be ${developerInstallationProfileFormatVersion}.`,
    );
  }
  return {
    applicationDirectory: pathValue(input.applicationDirectory, "applicationDirectory"),
    backupDirectory: pathValue(input.backupDirectory, "backupDirectory"),
    dataRoot: pathValue(input.dataRoot, "dataRoot"),
    databasePath: pathValue(input.databasePath, "databasePath"),
    formatVersion: developerInstallationProfileFormatVersion,
    installationProfilePath: pathValue(
      input.installationProfilePath,
      "installationProfilePath",
    ),
    mcpScriptPath: pathValue(input.mcpScriptPath, "mcpScriptPath"),
    migrationsDirectory: pathValue(input.migrationsDirectory, "migrationsDirectory"),
    nodeExecutablePath: pathValue(input.nodeExecutablePath, "nodeExecutablePath"),
    serverName: identifier(input.serverName, "serverName"),
  };
}

export function loadDeveloperInstallationProfile(
  profilePath = win32.join(defaultDeveloperDataRoot(), "installation.json"),
): DeveloperInstallationProfile {
  directPath(profilePath, "file", "Developer installation profile");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Developer installation profile could not be read: ${message}`);
  }
  return parseDeveloperInstallationProfile(value);
}

function samePath(left: string, right: string): boolean {
  return win32.resolve(left).toLocaleLowerCase("en-US") ===
    win32.resolve(right).toLocaleLowerCase("en-US");
}

function assertExistingProfile(
  existing: DeveloperInstallationProfile,
  expected: DeveloperInstallationProfile,
): void {
  for (const key of [
    "applicationDirectory", "backupDirectory", "dataRoot", "databasePath",
    "installationProfilePath", "mcpScriptPath", "migrationsDirectory",
    "nodeExecutablePath",
  ] as const) {
    if (!samePath(existing[key], expected[key])) {
      throw new Error(
        `The saved Developer profile uses a different ${key}; setup will not overwrite it.`,
      );
    }
  }
  if (existing.serverName !== expected.serverName) {
    throw new Error(
      "The saved Developer profile uses a different serverName; setup will not overwrite it.",
    );
  }
}

function verifyDatabase(database: ReturnType<typeof openMemTextualDatabase>): void {
  const integrity = database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  if (integrity.map((row) => row.integrity_check).join("; ") !== "ok") {
    throw new Error("Developer database integrity check failed.");
  }
  const foreignKeys = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0) {
    throw new Error(
      `Developer database foreign-key check failed with ${foreignKeys.length} violation(s).`,
    );
  }
}

export async function initializeDeveloperInstallation(input: {
  applicationDirectory: string;
  backupDirectory?: string;
  dataRoot?: string;
  databasePath?: string;
  nodeExecutablePath?: string;
  serverName?: string;
}): Promise<DeveloperInstallationResult> {
  if (process.platform !== "win32") {
    throw new Error("Automated Developer installation currently requires Windows.");
  }
  if (process.versions.node !== "24.21.0") {
    throw new Error("MemTextual Developer requires Node 24.21.0.");
  }
  const profile = createDeveloperInstallationProfile(input);
  validateBackupLocation(profile.databasePath, profile.backupDirectory);
  directPath(profile.applicationDirectory, "directory", "Developer application directory");
  directPath(profile.migrationsDirectory, "directory", "Developer migrations directory");
  directPath(profile.mcpScriptPath, "file", "Developer MCP server");
  directPath(profile.nodeExecutablePath, "file", "Developer Node executable");

  if (existsSync(profile.installationProfilePath)) {
    const existing = loadDeveloperInstallationProfile(profile.installationProfilePath);
    assertExistingProfile(existing, profile);
    directPath(existing.databasePath, "file", "Developer database");
    const database = openMemTextualDatabase({
      filename: existing.databasePath,
      readonly: true,
    });
    try {
      verifyDatabase(database);
    } finally {
      database.close();
    }
    return { created: false, databaseCreated: false, profile: existing };
  }

  mkdirSync(dirname(profile.databasePath), { recursive: true });
  mkdirSync(profile.backupDirectory, { recursive: true });
  const databaseExisted = existsSync(profile.databasePath);
  let snapshot = databaseExisted
    ? await createDatabaseSnapshot({
        databasePath: profile.databasePath,
        outputDirectory: profile.backupDirectory,
      })
    : undefined;

  const database = openMemTextualDatabase({
    filename: profile.databasePath,
    migrationsDirectory: profile.migrationsDirectory,
  });
  try {
    verifyDatabase(database);
  } finally {
    database.close();
  }

  if (!databaseExisted) {
    snapshot = await createDatabaseSnapshot({
      databasePath: profile.databasePath,
      outputDirectory: profile.backupDirectory,
    });
  }
  writeManagedJson(
    profile.installationProfilePath,
    profile,
    "Developer installation profile",
  );
  return {
    created: true,
    databaseCreated: !databaseExisted,
    profile,
    ...(snapshot === undefined ? {} : { snapshotPath: snapshot.backupPath }),
  };
}
