#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContinuityUpgrade } from "../safeguards/continuity-upgrade-validation.js";

interface ContinuityUpgradeCliArguments {
  backupDirectory: string;
  databasePath: string;
  migrationsDirectory: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-upgrade validate --database PATH --backup-directory DIRECTORY --migrations TARGET_DIRECTORY",
    "",
    "Validation snapshots the active database, upgrades only a disposable copy,",
    "verifies durable-data preservation, and leaves the active database unchanged.",
  ].join("\n");
}

export function parseContinuityUpgradeCliArguments(
  argv: readonly string[],
): ContinuityUpgradeCliArguments {
  if (argv[0] !== "validate") {
    throw new Error(`Expected validate.\n\n${usage()}`);
  }
  const allowed = new Set(["--backup-directory", "--database", "--migrations"]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}.\n\n${usage()}`);
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
  const backupDirectory = values.get("--backup-directory")?.trim();
  const databasePath = values.get("--database")?.trim();
  const migrationsDirectory = values.get("--migrations")?.trim();
  if (
    backupDirectory === undefined ||
    backupDirectory.length === 0 ||
    databasePath === undefined ||
    databasePath.length === 0 ||
    migrationsDirectory === undefined ||
    migrationsDirectory.length === 0
  ) {
    throw new Error(`All validation paths are required.\n\n${usage()}`);
  }
  return { backupDirectory, databasePath, migrationsDirectory };
}

export async function runContinuityUpgradeCli(
  argv: readonly string[],
): Promise<unknown> {
  const arguments_ = parseContinuityUpgradeCliArguments(argv);
  return validateContinuityUpgrade({
    backupDirectory: arguments_.backupDirectory,
    databasePath: arguments_.databasePath,
    targetMigrationsDirectory: arguments_.migrationsDirectory,
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runContinuityUpgradeCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown upgrade error";
      process.stderr.write(`MemTextual Continuity upgrade validation failed: ${message}\n`);
      process.exitCode = 1;
    });
}
