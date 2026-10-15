#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { createDatabaseSnapshot } from "../safeguards/database-safeguard.js";
import {
  ContinuityOnboardingService,
  type ContinuityOnboardingInput,
} from "../services/continuity-onboarding-service.js";

interface ParsedArguments {
  command: "setup" | "status";
  databaseArguments: string[];
  backupDirectory?: string;
  onboarding: ContinuityOnboardingInput;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-setup status [--database PATH] [--migrations PATH]",
    "  memtextual-continuity-setup setup --backup-directory DIRECTORY (--persona-name NAME | --persona-id ID) [--user-name NAME] [--user-id ID] [--description TEXT] [--relationship-name NAME] [--database PATH] [--migrations PATH]",
    "",
    "Setup creates or reuses one Continuity user and persona. It creates and",
    "verifies a database snapshot before changing an existing database.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const command = argv[0];
  if (command !== "setup" && command !== "status") {
    throw new Error(`Expected setup or status.\n\n${usage()}`);
  }
  const values = new Map<string, string>();
  const databaseArguments: string[] = [];
  const allowed = new Set([
    "--database",
    "--migrations",
    "--backup-directory",
    "--user-id",
    "--user-name",
    "--persona-id",
    "--persona-name",
    "--description",
    "--relationship-name",
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.\n\n${usage()}`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.`);
    }
    index += 1;
    values.set(option, value);
    if (option === "--database" || option === "--migrations") {
      databaseArguments.push(option, value);
    }
  }

  const setupOnly = [
    "--backup-directory",
    "--user-id",
    "--user-name",
    "--persona-id",
    "--persona-name",
    "--description",
    "--relationship-name",
  ];
  if (command === "status") {
    const invalid = setupOnly.find((option) => values.has(option));
    if (invalid !== undefined) {
      throw new Error(`${invalid} is valid only with setup.\n\n${usage()}`);
    }
    return { command, databaseArguments, onboarding: {} };
  }

  const backupDirectory = values.get("--backup-directory")?.trim();
  if (backupDirectory === undefined || backupDirectory.length === 0) {
    throw new Error(`setup requires --backup-directory.\n\n${usage()}`);
  }
  const onboarding: ContinuityOnboardingInput = {
    ...(values.has("--user-id") ? { userId: values.get("--user-id")! } : {}),
    ...(values.has("--user-name")
      ? { userDisplayName: values.get("--user-name")! }
      : {}),
    ...(values.has("--persona-id")
      ? { personaId: values.get("--persona-id")! }
      : {}),
    ...(values.has("--persona-name")
      ? { personaName: values.get("--persona-name")! }
      : {}),
    ...(values.has("--description")
      ? { personaDescription: values.get("--description")! }
      : {}),
    ...(values.has("--relationship-name")
      ? { relationshipName: values.get("--relationship-name")! }
      : {}),
  };
  return { command, databaseArguments, backupDirectory, onboarding };
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function validateBackupLocation(databasePath: string, backupDirectory: string): void {
  const databaseDirectory = dirname(databasePath);
  if (databaseDirectory === backupDirectory) {
    throw new Error(
      "The onboarding backup directory must differ from the active database directory.",
    );
  }
  if (isWithin(backupDirectory, databasePath)) {
    throw new Error(
      "The active database may not be stored inside its onboarding backup directory.",
    );
  }
  if (isWithin(databaseDirectory, backupDirectory)) {
    throw new Error(
      "The onboarding backup directory may not be stored inside the active database directory.",
    );
  }
}

function verifyOpenDatabase(database: ReturnType<typeof openMemTextualDatabase>): void {
  const integrity = database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  const integrityMessage = integrity.map((row) => row.integrity_check).join("; ");
  if (integrityMessage !== "ok") {
    throw new Error(`Database integrity check failed: ${integrityMessage}`);
  }
  const foreignKeys = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0) {
    throw new Error(
      `Database foreign-key check failed with ${foreignKeys.length} violation(s).`,
    );
  }
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = resolveMcpRuntimeConfig({ argv: arguments_.databaseArguments });
  if (arguments_.command === "status") {
    if (!existsSync(config.databasePath)) {
      process.stdout.write("MemTextual Continuity is not initialized.\n");
      return;
    }
    const database = openMemTextualDatabase({
      filename: config.databasePath,
      readonly: true,
    });
    try {
      const onboarding = new ContinuityOnboardingService(
        new SqlitePersonaRepository(database),
      );
      process.stdout.write(`${JSON.stringify(onboarding.status(), null, 2)}\n`);
    } finally {
      database.close();
    }
    return;
  }

  const backupDirectory = resolve(arguments_.backupDirectory!);
  validateBackupLocation(config.databasePath, backupDirectory);
  mkdirSync(dirname(config.databasePath), { recursive: true });

  let snapshot;
  const databaseExisted = existsSync(config.databasePath);
  if (databaseExisted) {
    snapshot = await createDatabaseSnapshot({
      databasePath: config.databasePath,
      outputDirectory: backupDirectory,
    });
  }

  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });
  try {
    if (!databaseExisted) {
      snapshot = await createDatabaseSnapshot({
        databasePath: config.databasePath,
        outputDirectory: backupDirectory,
      });
    }
    const onboarding = new ContinuityOnboardingService(
      new SqlitePersonaRepository(database),
    );
    const result = database.transaction(() => {
      const setup = onboarding.setup(arguments_.onboarding);
      verifyOpenDatabase(database);
      return setup;
    })();

    process.stdout.write(
      `${JSON.stringify(
        {
          user: {
            id: result.user.id,
            displayName: result.user.displayName,
            created: result.createdUser,
          },
          persona: {
            id: result.personaContext.persona.id,
            name: result.personaContext.persona.name,
            created: result.createdPersona,
          },
          relationshipId: result.personaContext.relationship.id,
          snapshot: snapshot!.backupPath,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write("\nStart the persona-bound console with:\n");
    process.stdout.write(
      `npm run continuity -- --persona ${result.personaContext.persona.id} --database "${config.databasePath}" --migrations "${config.migrationsDirectory}"\n`,
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown onboarding error";
  process.stderr.write(`MemTextual Continuity setup failed: ${message}\n`);
  process.exitCode = 1;
});
