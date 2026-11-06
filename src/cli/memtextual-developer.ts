#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDeveloperDataRoot,
  initializeDeveloperInstallation,
  loadDeveloperInstallationProfile,
} from "../configuration/developer-installation-profile.js";
import {
  assertDeveloperCodexRegistrationConfirmation,
  parseCodexMcpList,
  previewDeveloperCodexRegistration,
} from "../integrations/codex-mcp-registration.js";
import {
  discoverCodexDesktopCommands,
  selectCodexDesktopCommand,
} from "../integrations/codex-command-discovery.js";

type Command = "connect-apply" | "connect-preview" | "setup" | "status";

interface Arguments {
  command: Command;
  values: Map<string, string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual developer setup [--data-root PATH] [--database PATH] [--backup-directory PATH] [--application-directory PATH] [--node PATH] [--server-name NAME]",
    "  memtextual developer status [--data-root PATH]",
    "  memtextual developer connect-preview [--data-root PATH] [--codex-command PATH]",
    "  memtextual developer connect-apply --confirm TOKEN [--data-root PATH] [--codex-command PATH]",
    "",
    "Setup creates a per-user Developer profile under LocalAppData by default.",
    "Codex registration is read-only until connect-apply receives the exact",
    "fresh token. A different existing registration is never overwritten.",
  ].join("\n");
}

function parse(argv: readonly string[]): Arguments {
  const command = argv[0] as Command | undefined;
  if (
    command !== "setup" &&
    command !== "status" &&
    command !== "connect-preview" &&
    command !== "connect-apply"
  ) {
    throw new Error(`Unknown or missing Developer command.\n\n${usage()}`);
  }
  const allowed = new Set([
    "--application-directory", "--backup-directory", "--codex-command",
    "--confirm", "--data-root", "--database", "--node", "--server-name",
  ]);
  const values = new Map<string, string>();
  let separatorSeen = false;
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === "--") {
      if (separatorSeen) {
        throw new Error(`Duplicate argument separator.\n\n${usage()}`);
      }
      separatorSeen = true;
      continue;
    }
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}.\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  return { command, values };
}

function findApplicationDirectory(start = dirname(fileURLToPath(import.meta.url))): string {
  let candidate = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(join(candidate, "migrations")) &&
      existsSync(join(candidate, "dist", "src", "mcp", "stdio.js"))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }
  throw new Error(
    "Could not locate a built MemTextual application directory. Run npm run build first.",
  );
}

function dataRoot(values: Map<string, string>): string {
  return win32.resolve(values.get("--data-root") ?? defaultDeveloperDataRoot());
}

function profilePath(values: Map<string, string>): string {
  return win32.join(dataRoot(values), "installation.json");
}

interface CodexExecution {
  command: string;
  result: ReturnType<typeof spawnSync>;
}

function isMissingCommand(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function executeCodex(
  arguments_: readonly string[],
  explicitCommand?: string,
): CodexExecution {
  let command = explicitCommand ?? "codex";
  let result = spawnSync(command, arguments_, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error && isMissingCommand(result.error) && explicitCommand === undefined) {
    const discovered = selectCodexDesktopCommand(discoverCodexDesktopCommands());
    if (discovered === undefined) {
      throw new Error(
        "Codex CLI was not found on PATH or in the Codex desktop installation. " +
        "Start Codex once or specify its executable with --codex-command.",
      );
    }
    command = discovered;
    result = spawnSync(command, arguments_, {
      encoding: "utf8",
      windowsHide: true,
    });
  }
  if (result.error) {
    const detail = isMissingCommand(result.error)
      ? `Codex CLI could not be started at ${command}.`
      : result.error.message;
    throw new Error(detail);
  }
  return { command, result };
}

function codexInventory(explicitCommand?: string): {
  command: string;
  inventory: ReturnType<typeof parseCodexMcpList>;
} {
  const execution = executeCodex(["mcp", "list", "--json"], explicitCommand);
  const { command, result } = execution;
  if (result.status !== 0) {
    throw new Error(
      (typeof result.stderr === "string" && result.stderr.trim()) ||
      "Codex MCP inventory failed.",
    );
  }
  try {
    return {
      command,
      inventory: parseCodexMcpList(JSON.parse(String(result.stdout))),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Codex MCP inventory could not be parsed: ${message}`);
  }
}

async function setup(values: Map<string, string>): Promise<void> {
  const result = await initializeDeveloperInstallation({
    applicationDirectory: win32.resolve(
      values.get("--application-directory") ?? findApplicationDirectory(),
    ),
    ...(values.has("--backup-directory")
      ? { backupDirectory: values.get("--backup-directory")! }
      : {}),
    dataRoot: dataRoot(values),
    ...(values.has("--database")
      ? { databasePath: values.get("--database")! }
      : {}),
    ...(values.has("--node")
      ? { nodeExecutablePath: values.get("--node")! }
      : {}),
    ...(values.has("--server-name")
      ? { serverName: values.get("--server-name")! }
      : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write("\nNext: run memtextual developer connect-preview.\n");
}

function status(values: Map<string, string>): void {
  process.stdout.write(
    `${JSON.stringify(loadDeveloperInstallationProfile(profilePath(values)), null, 2)}\n`,
  );
}

function connectPreview(values: Map<string, string>) {
  const profile = loadDeveloperInstallationProfile(profilePath(values));
  const { inventory } = codexInventory(values.get("--codex-command"));
  return previewDeveloperCodexRegistration(profile, inventory);
}

function preview(values: Map<string, string>): void {
  process.stdout.write(`${JSON.stringify(connectPreview(values), null, 2)}\n`);
}

function apply(values: Map<string, string>): void {
  const confirmation = values.get("--confirm")?.trim();
  if (!confirmation) {
    throw new Error("--confirm is required for connect-apply.");
  }
  const profile = loadDeveloperInstallationProfile(profilePath(values));
  const initial = codexInventory(values.get("--codex-command"));
  const command = initial.command;
  const current = previewDeveloperCodexRegistration(
    profile,
    initial.inventory,
  );
  assertDeveloperCodexRegistrationConfirmation(current, confirmation);
  const registration = current.registration;
  const result = executeCodex(
    [
      "mcp", "add", registration.name, "--", registration.command,
      ...registration.arguments,
    ],
    command,
  ).result;
  if (result.status !== 0) {
    throw new Error(
      (typeof result.stderr === "string" && result.stderr.trim()) ||
      "Codex MCP registration failed.",
    );
  }
  const verified = previewDeveloperCodexRegistration(
    profile,
    codexInventory(command).inventory,
  );
  if (verified.action !== "already-connected") {
    throw new Error(
      "Codex did not report the exact registration. No existing entry was automatically removed.",
    );
  }
  process.stdout.write(`${JSON.stringify(verified, null, 2)}\n`);
  process.stdout.write(
    "\nMemTextual Developer is connected. Start a new Codex task before using it.\n",
  );
}

async function main(): Promise<void> {
  const arguments_ = parse(process.argv.slice(2));
  if (arguments_.command === "setup") {
    await setup(arguments_.values);
  } else if (arguments_.command === "status") {
    status(arguments_.values);
  } else if (arguments_.command === "connect-preview") {
    preview(arguments_.values);
  } else {
    apply(arguments_.values);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Developer setup error";
  process.stderr.write(`MemTextual Developer failed: ${message}\n`);
  process.exitCode = 1;
});
