#!/usr/bin/env node

import { loadContinuityInstallationProfile } from "../configuration/continuity-installation-profile.js";
import {
  loadContinuityRemoteConfiguration,
} from "../configuration/continuity-remote-configuration.js";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { CodexAppServerConversationHost } from "../hosts/codex-app-server-conversation-host.js";
import { resolveCodexCommand } from "../integrations/codex-command-discovery.js";
import { loadAuth0OAuthMetadata } from "../mcp/auth0-oauth-metadata.js";
import {
  assertContinuityConversationDatabasePath,
  assertContinuityConversationMigrationsPath,
  resolveContinuityConversationConfiguration,
} from "../runtime/continuity-conversation-configuration.js";
import { startContinuityRemoteRuntime } from "../runtime/continuity-remote-runtime.js";

interface ParsedArguments {
  codexCommand?: string;
  profilePath?: string;
  remoteConfigurationPath: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-remote --remote-config PATH [--profile PATH] [--codex-command PATH]",
    "",
    "Starts the Auth0-protected Continuity MCP endpoint on configured IPv4 loopback only.",
    "The public HTTPS origin must be forwarded by an independently configured private tunnel.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const allowed = new Set(["--codex-command", "--profile", "--remote-config"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.\n\n${usage()}`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.\n\n${usage()}`);
    }
    values.set(option, value);
    index += 1;
  }
  const remoteConfigurationPath = values.get("--remote-config")?.trim();
  if (remoteConfigurationPath === undefined || remoteConfigurationPath === "") {
    throw new Error(`--remote-config is required.\n\n${usage()}`);
  }
  const profilePath = values.get("--profile");
  const codexCommand = values.get("--codex-command");
  return {
    remoteConfigurationPath,
    ...(profilePath === undefined ? {} : { profilePath }),
    ...(codexCommand === undefined ? {} : { codexCommand }),
  };
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const profile = loadContinuityInstallationProfile(arguments_.profilePath);
  const conversation = resolveContinuityConversationConfiguration(
    profile.conversationConfigurationPath,
  );
  assertContinuityConversationDatabasePath(conversation, profile.databasePath);
  assertContinuityConversationMigrationsPath(
    conversation,
    profile.migrationsDirectory,
  );
  const remote = loadContinuityRemoteConfiguration(
    arguments_.remoteConfigurationPath,
  );
  const oauthMetadata = await loadAuth0OAuthMetadata({
    issuer: remote.auth0Issuer,
  });
  const database = openMemTextualDatabase({
    filename: profile.databasePath,
    migrationsDirectory: profile.migrationsDirectory,
  });
  const sensitivityRunner = new CodexAppServerConversationHost({
    command: resolveCodexCommand({
      ...(arguments_.codexCommand === undefined
        ? {}
        : { explicitCommand: arguments_.codexCommand }),
    }),
    workingDirectory: conversation.workingDirectory,
  });
  let runtime;
  try {
    runtime = await startContinuityRemoteRuntime({
      configuration: remote,
      database,
      oauthMetadata,
      sensitivityModel: conversation.extractionModel,
      sensitivityRunner,
    });
  } catch (error) {
    await sensitivityRunner.close().catch(() => undefined);
    database.close();
    throw error;
  }

  process.stdout.write("MemTextual Continuity remote MCP is ready.\n");
  process.stdout.write(`Local tunnel target: ${runtime.localOrigin}\n`);
  process.stdout.write(`Public MCP resource: ${runtime.resourceServerUrl.href}\n`);
  process.stdout.write(`Write mode: ${remote.writeAuthorization.mode}\n`);
  process.stdout.write("Press Ctrl+C to stop the endpoint.\n");

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    let firstError: unknown;
    try {
      await runtime.close();
    } catch (error) {
      firstError = error;
    }
    try {
      database.close();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  };
  const closeFromSignal = (): void => {
    void close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown shutdown error";
      process.stderr.write(`MemTextual Continuity remote shutdown failed: ${message}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", closeFromSignal);
  process.once("SIGTERM", closeFromSignal);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown remote startup error";
  process.stderr.write(`MemTextual Continuity remote failed: ${message}\n`);
  process.exitCode = 1;
});
