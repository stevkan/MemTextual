#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve, win32 } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { collectContinuityInteractiveSetupInput } from "../configuration/continuity-interactive-setup.js";
import {
  assertCompatibleManagedJson,
  continuityInstallationProfileFormatVersion,
  createContinuityInstallationConfiguration,
  createContinuityInstallationDirectories,
  defaultContinuityDataRoot,
  loadContinuityInstallationProfile,
  writeManagedJson,
  type ContinuityInstallationProfile,
} from "../configuration/continuity-installation-profile.js";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { CodexAppServerConversationHost } from "../hosts/codex-app-server-conversation-host.js";
import { resolveCodexCommand } from "../integrations/codex-command-discovery.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import {
  ContinuityOnboardingService,
  type ContinuityOnboardingUserStatus,
} from "../services/continuity-onboarding-service.js";

type Command =
  | "host-install-apply"
  | "host-install-preview"
  | "host-remove-apply"
  | "host-remove-preview"
  | "models"
  | "setup"
  | "start"
  | "status";

interface Arguments {
  command: Command;
  flags: Set<string>;
  values: Map<string, string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual developer setup [OPTIONS]",
    "  memtextual developer status [OPTIONS]",
    "  memtextual developer connect-preview [OPTIONS]",
    "  memtextual developer connect-apply --confirm TOKEN [OPTIONS]",
    "  memtextual models [--codex-command PATH]",
    "  memtextual setup --interactive [--extraction-model MODEL] [--codex-command PATH] [--data-root PATH] [--application-directory PATH]",
    "  memtextual setup --user-name NAME --persona-name NAME --extraction-model MODEL [--data-root PATH] [--backup-directory PATH] [--application-directory PATH] [--identity-name NAME] [--description TEXT] [--relationship-name NAME]",
    "  memtextual status [--data-root PATH]",
    "  memtextual start [--data-root PATH] [--port PORT]",
    "  memtextual host-install-preview [--data-root PATH]",
    "  memtextual host-install-apply --confirm TOKEN --actor ACTOR [--data-root PATH]",
    "  memtextual host-remove-preview [--data-root PATH]",
    "  memtextual host-remove-apply --confirm TOKEN --actor ACTOR [--data-root PATH]",
    "",
    "Routine paths are read from the saved installation profile. Host apply",
    "commands retain the existing elevated-terminal and exact-token safeguards.",
  ].join("\n");
}

function parse(argv: readonly string[]): Arguments {
  const command = argv[0] as Command | undefined;
  const commands = new Set<Command>([
    "host-install-apply", "host-install-preview", "host-remove-apply",
    "host-remove-preview", "models", "setup", "start", "status",
  ]);
  if (command === undefined || !commands.has(command)) {
    throw new Error(`Unknown or missing command.\n\n${usage()}`);
  }
  const allowed = new Set([
    "--actor", "--application-directory", "--backup-directory", "--codex-command", "--confirm",
    "--data-root", "--description", "--extraction-model", "--identity-name",
    "--persona-name", "--port", "--relationship-name", "--user-name",
  ]);
  const values = new Map<string, string>();
  const flags = new Set<string>();
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
    if (option === "--interactive") {
      if (flags.has(option)) {
        throw new Error(`Duplicate argument: ${option}.`);
      }
      flags.add(option);
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
  return { command, flags, values };
}

function required(values: Map<string, string>, option: string): string {
  const value = values.get(option)?.trim();
  if (!value) {
    throw new Error(`${option} is required.`);
  }
  return value;
}

function requiredExtractionModel(values: Map<string, string>): string {
  const model = required(values, "--extraction-model");
  if (/^(?:EXPLICIT_CODEX_MODEL_ID|MODEL_ID|MODEL_ID_FROM_LIST)$/iu.test(model)) {
    throw new Error(
      "--extraction-model requires an actual model identifier returned by `memtextual models`; placeholder text is not valid.",
    );
  }
  return model;
}

function dataRoot(values: Map<string, string>): string {
  return win32.resolve(values.get("--data-root") ?? defaultContinuityDataRoot());
}

function profilePath(values: Map<string, string>): string {
  return win32.join(dataRoot(values), "installation.json");
}

function findApplicationDirectory(start = dirname(fileURLToPath(import.meta.url))): string {
  let candidate = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(join(candidate, "migrations")) &&
      existsSync(join(candidate, "scripts", "windows-host-executor.ps1"))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      break;
    }
    candidate = parent;
  }
  throw new Error("Could not locate the MemTextual application directory.");
}

function siblingArguments(name: string, arguments_: readonly string[]): string[] {
  const current = fileURLToPath(import.meta.url);
  const extension = extname(current);
  const script = join(dirname(current), `${name}${extension}`);
  return extension === ".ts"
    ? ["--import", "tsx", script, ...arguments_]
    : [script, ...arguments_];
}

function runSibling(
  name: string,
  arguments_: readonly string[],
  stdio: "inherit" | "pipe" = "inherit",
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, siblingArguments(name, arguments_), {
    encoding: "utf8",
    stdio,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function onboardingStatus(
  profile: ContinuityInstallationProfile,
): ContinuityOnboardingUserStatus[] {
  const database = openMemTextualDatabase({
    filename: profile.databasePath,
    readonly: true,
  });
  try {
    return new ContinuityOnboardingService(
      new SqlitePersonaRepository(database),
    ).status();
  } finally {
    database.close();
  }
}

function validateExistingProfile(
  profile: ContinuityInstallationProfile,
  expectedPaths: ReturnType<typeof createContinuityInstallationConfiguration>["paths"],
): void {
  for (const key of [
    "applicationDirectory", "backupDirectory", "conversationConfigurationPath",
    "dataRoot", "databasePath", "deploymentConfigurationPath",
    "installationProfilePath", "migrationsDirectory", "stateDirectory",
    "workingDirectory",
  ] as const) {
    if (
      win32.resolve(profile[key]).toLocaleLowerCase("en-US") !==
      win32.resolve(expectedPaths[key]).toLocaleLowerCase("en-US")
    ) {
      throw new Error(
        `The saved installation profile uses a different ${key}; setup will not overwrite it.`,
      );
    }
  }
}

function setup(values: Map<string, string>): void {
  if (process.platform !== "win32") {
    throw new Error("Automated Continuity installation currently requires Windows.");
  }
  const userName = required(values, "--user-name");
  const personaName = required(values, "--persona-name");
  const extractionModel = requiredExtractionModel(values);
  const applicationDirectory = win32.resolve(
    values.get("--application-directory") ?? findApplicationDirectory(),
  );
  const configuration = createContinuityInstallationConfiguration({
    applicationDirectory,
    ...(values.has("--backup-directory")
      ? { backupDirectory: values.get("--backup-directory")! }
      : {}),
    dataRoot: dataRoot(values),
    extractionModel,
    ...(values.has("--identity-name")
      ? { identityName: values.get("--identity-name")! }
      : {}),
  });
  assertCompatibleManagedJson(
    configuration.paths.deploymentConfigurationPath,
    configuration.deployment,
    "Continuity deployment configuration",
  );
  assertCompatibleManagedJson(
    configuration.paths.conversationConfigurationPath,
    configuration.conversation,
    "Continuity conversation configuration",
  );

  if (existsSync(configuration.paths.installationProfilePath)) {
    const existing = loadContinuityInstallationProfile(
      configuration.paths.installationProfilePath,
    );
    validateExistingProfile(existing, configuration.paths);
    const statuses = onboardingStatus(existing);
    const user = statuses.find(({ user }) => user.id === existing.userId);
    const persona = user?.personas.find(
      ({ persona }) => persona.id === existing.personaId,
    );
    if (
      user === undefined ||
      persona === undefined ||
      user.user.displayName.localeCompare(
        userName, undefined, { sensitivity: "accent" },
      ) !== 0 ||
      persona.persona.name.localeCompare(
        personaName, undefined, { sensitivity: "accent" },
      ) !== 0
    ) {
      throw new Error(
        "The requested user or persona does not match the saved installation profile.",
      );
    }
    process.stdout.write(
      `${JSON.stringify({ installation: existing, onboarding: statuses }, null, 2)}\n`,
    );
    process.stdout.write("\nMemTextual Continuity is already configured.\n");
    return;
  }

  createContinuityInstallationDirectories(configuration.paths);
  const onboardingArguments = [
    "setup",
    "--backup-directory", configuration.paths.backupDirectory,
    "--database", configuration.paths.databasePath,
    "--migrations", configuration.paths.migrationsDirectory,
    "--user-name", userName,
    "--persona-name", personaName,
    ...(values.has("--description")
      ? ["--description", values.get("--description")!]
      : []),
    ...(values.has("--relationship-name")
      ? ["--relationship-name", values.get("--relationship-name")!]
      : []),
  ];
  const result = runSibling("continuity-setup", onboardingArguments, "pipe");
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Continuity onboarding failed.");
  }

  const database = openMemTextualDatabase({
    filename: configuration.paths.databasePath,
    readonly: true,
  });
  let profile: ContinuityInstallationProfile;
  try {
    const statuses = new ContinuityOnboardingService(
      new SqlitePersonaRepository(database),
    ).status();
    const user = statuses.find(
      (entry) => entry.user.displayName.localeCompare(
        userName, undefined, { sensitivity: "accent" },
      ) === 0,
    );
    const persona = user?.personas.find(
      (entry) => entry.persona.name.localeCompare(
        personaName, undefined, { sensitivity: "accent" },
      ) === 0,
    );
    if (!user || !persona) {
      throw new Error("Onboarding completed but the configured user or persona could not be resolved.");
    }
    profile = {
      ...configuration.paths,
      formatVersion: continuityInstallationProfileFormatVersion,
      personaId: persona.persona.id,
      userId: user.user.id,
    };
  } finally {
    database.close();
  }

  writeManagedJson(
    configuration.paths.deploymentConfigurationPath,
    configuration.deployment,
    "Continuity deployment configuration",
  );
  writeManagedJson(
    configuration.paths.conversationConfigurationPath,
    configuration.conversation,
    "Continuity conversation configuration",
  );
  writeManagedJson(
    configuration.paths.installationProfilePath,
    profile,
    "Continuity installation profile",
  );

  process.stdout.write(
    `${JSON.stringify({ installation: profile, onboardingOutput: result.stdout.trim() }, null, 2)}\n`,
  );
  process.stdout.write("\nNext: run memtextual host-install-preview.\n");
}

async function modelCatalog(values: Map<string, string>) {
  const explicitCommand = values.get("--codex-command");
  const host = new CodexAppServerConversationHost({
    command: resolveCodexCommand({
      ...(explicitCommand === undefined ? {} : { explicitCommand }),
    }),
    // model/list performs no conversation or inference and therefore cannot
    // inherit project instructions from this required process directory.
    workingDirectory: resolve("."),
  });
  try {
    const models = await host.listModels();
    if (models.length === 0) {
      throw new Error("Codex App Server returned no selectable models.");
    }
    return models;
  } finally {
    await host.close();
  }
}

async function models(values: Map<string, string>): Promise<void> {
  process.stdout.write("Reading the Codex App Server model catalog...\n");
  const available = await modelCatalog(values);
  process.stdout.write(
    `${JSON.stringify({
      entitlementVerified: false,
      models: available,
      note: "The catalog is not an access guarantee; the first successful inference verifies access.",
      source: "codex-app-server:model/list",
    }, null, 2)}\n`,
  );
}

function status(values: Map<string, string>): void {
  const profile = loadContinuityInstallationProfile(profilePath(values));
  process.stdout.write(
    `${JSON.stringify({ installation: profile, onboarding: onboardingStatus(profile) }, null, 2)}\n`,
  );
}

function start(values: Map<string, string>): void {
  const profile = loadContinuityInstallationProfile(profilePath(values));
  const result = runSibling("continuity-console", [
    "--persona", profile.personaId,
    "--conversation-config", profile.conversationConfigurationPath,
    "--database", profile.databasePath,
    "--migrations", profile.migrationsDirectory,
    ...(values.has("--port") ? ["--port", values.get("--port")!] : []),
  ]);
  if (result.status !== 0) {
    throw new Error(`Continuity client exited with status ${result.status}.`);
  }
}

function host(command: Command, values: Map<string, string>): void {
  const profile = loadContinuityInstallationProfile(profilePath(values));
  const mapped = command.replace("host-", "");
  const arguments_ = [mapped, "--config", profile.deploymentConfigurationPath];
  if (command.endsWith("-apply")) {
    arguments_.push(
      "--confirm", required(values, "--confirm"),
      "--actor", required(values, "--actor"),
    );
  }
  const result = runSibling("windows-host", arguments_);
  if (result.status !== 0) {
    throw new Error(`Windows host command exited with status ${result.status}.`);
  }
}

const interactiveSetupValueOptions = [
  "--backup-directory",
  "--description",
  "--persona-name",
  "--relationship-name",
  "--user-name",
] as const;

async function interactiveSetup(values: Map<string, string>): Promise<void> {
  const conflicting = interactiveSetupValueOptions.find((option) =>
    values.has(option)
  );
  if (conflicting !== undefined) {
    throw new Error(
      `${conflicting} cannot be combined with --interactive; enter it when prompted.`,
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    if (existsSync(profilePath(values))) {
      status(values);
      process.stdout.write(
        "\nMemTextual Continuity is already configured. No settings were changed.\n",
      );
      return;
    }

    process.stdout.write(
      [
        "MemTextual Continuity first-run setup",
        "No password, API key, or recovery key will be requested or stored.",
        "Required answers must be entered explicitly.",
        "",
      ].join("\n"),
    );
    const explicitExtractionModel = values.get("--extraction-model");
    const availableModels = explicitExtractionModel === undefined
      ? await modelCatalog(values)
      : undefined;
    const answers = await collectContinuityInteractiveSetupInput({
      ask: (prompt) => readline.question(prompt),
      dataRoot: dataRoot(values),
      ...(explicitExtractionModel === undefined
        ? { extractionModels: availableModels! }
        : { extractionModel: explicitExtractionModel }),
    });
    const configured = new Map(values);
    configured.set("--backup-directory", answers.backupDirectory);
    configured.set("--extraction-model", answers.extractionModel);
    configured.set("--persona-name", answers.personaName);
    configured.set("--user-name", answers.userDisplayName);
    if (answers.personaDescription !== undefined) {
      configured.set("--description", answers.personaDescription);
    }
    if (answers.relationshipName !== undefined) {
      configured.set("--relationship-name", answers.relationshipName);
    }
    setup(configured);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown setup error";
    process.stderr.write(`MemTextual interactive setup failed: ${message}\n`);
    process.exitCode = 1;
  } finally {
    try {
      await readline.question("\nPress Enter to close.");
    } catch {
      // A closed input stream needs no additional action.
    }
    readline.close();
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "developer") {
    const result = runSibling("memtextual-developer", process.argv.slice(3));
    process.exitCode = result.status;
    return;
  }
  const arguments_ = parse(process.argv.slice(2));
  if (arguments_.flags.has("--interactive")) {
    if (arguments_.command !== "setup") {
      throw new Error("--interactive is valid only with setup.");
    }
    await interactiveSetup(arguments_.values);
    return;
  }
  if (arguments_.command === "setup") {
    setup(arguments_.values);
  } else if (arguments_.command === "models") {
    await models(arguments_.values);
  } else if (arguments_.command === "status") {
    status(arguments_.values);
  } else if (arguments_.command === "start") {
    start(arguments_.values);
  } else {
    host(arguments_.command, arguments_.values);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown MemTextual error";
  process.stderr.write(`MemTextual failed: ${message}\n`);
  process.exitCode = 1;
});
