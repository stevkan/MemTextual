import { createHash } from "node:crypto";
import { win32 } from "node:path";
import type { DeveloperInstallationProfile } from "../configuration/developer-installation-profile.js";

export interface CodexMcpRegistration {
  arguments: readonly string[];
  command: string;
  name: string;
}

export interface CodexMcpRegistrationPreview {
  action: "add" | "already-connected" | "blocked-existing";
  confirmation?: string;
  name: string;
  reason: string;
  registration: CodexMcpRegistration;
}

interface CodexMcpListEntry {
  name: string;
  transport: {
    args?: string[];
    command?: string;
    type: string;
  };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return value as string[];
}

function parseEntry(value: unknown): CodexMcpListEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") {
    return null;
  }
  const transport = record.transport;
  if (typeof transport !== "object" || transport === null || Array.isArray(transport)) {
    return null;
  }
  const transportRecord = transport as Record<string, unknown>;
  if (typeof transportRecord.type !== "string") {
    return null;
  }
  if (transportRecord.type !== "stdio") {
    return {
      name: record.name,
      transport: { type: transportRecord.type },
    };
  }
  const arguments_ = stringArray(transportRecord.args);
  if (typeof transportRecord.command !== "string" || arguments_ === null) {
    return null;
  }
  return {
    name: record.name,
    transport: {
      args: arguments_,
      command: transportRecord.command,
      type: transportRecord.type,
    },
  };
}

export function parseCodexMcpList(value: unknown): CodexMcpListEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("Codex MCP server inventory must be an array.");
  }
  const parsed = value.map(parseEntry);
  if (parsed.some((entry) => entry === null)) {
    throw new Error("Codex MCP server inventory contains an unsupported entry.");
  }
  return parsed as CodexMcpListEntry[];
}

export function developerCodexRegistration(
  profile: DeveloperInstallationProfile,
): CodexMcpRegistration {
  return {
    arguments: [
      profile.mcpScriptPath,
      "--database",
      profile.databasePath,
      "--migrations",
      profile.migrationsDirectory,
    ],
    command: profile.nodeExecutablePath,
    name: profile.serverName,
  };
}

function samePath(left: string, right: string): boolean {
  return win32.resolve(left).toLocaleLowerCase("en-US") ===
    win32.resolve(right).toLocaleLowerCase("en-US");
}

function registrationMatches(
  entry: CodexMcpListEntry,
  desired: CodexMcpRegistration,
): boolean {
  if (
    entry.transport.type !== "stdio" ||
    entry.transport.command === undefined ||
    entry.transport.args === undefined
  ) {
    return false;
  }
  if (!samePath(entry.transport.command, desired.command)) {
    return false;
  }
  if (entry.transport.args.length !== desired.arguments.length) {
    return false;
  }
  return entry.transport.args.every((argument, index) => {
    const expected = desired.arguments[index]!;
    return index === 0 || index === 2 || index === 4
      ? samePath(argument, expected)
      : argument === expected;
  });
}

function confirmationFor(registration: CodexMcpRegistration): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(registration), "utf8")
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `CONNECT-CODEX-MCP-${hash}`;
}

export function previewDeveloperCodexRegistration(
  profile: DeveloperInstallationProfile,
  inventory: readonly CodexMcpListEntry[],
): CodexMcpRegistrationPreview {
  const registration = developerCodexRegistration(profile);
  const existing = inventory.find(({ name }) => name === registration.name);
  if (existing === undefined) {
    return {
      action: "add",
      confirmation: confirmationFor(registration),
      name: registration.name,
      reason: "No Codex MCP server uses this name.",
      registration,
    };
  }
  if (registrationMatches(existing, registration)) {
    return {
      action: "already-connected",
      name: registration.name,
      reason: "Codex already has the exact managed MemTextual registration.",
      registration,
    };
  }
  return {
    action: "blocked-existing",
    name: registration.name,
    reason:
      "Codex already has a different server with this name. It was not changed; remove or rename it explicitly before adding the managed registration.",
    registration,
  };
}

export function assertDeveloperCodexRegistrationConfirmation(
  preview: CodexMcpRegistrationPreview,
  confirmation: string,
): void {
  if (preview.action !== "add" || preview.confirmation === undefined) {
    throw new Error("The current Codex registration state is not eligible for add.");
  }
  if (confirmation !== preview.confirmation) {
    throw new Error("The Codex registration confirmation token is stale or incorrect.");
  }
}
