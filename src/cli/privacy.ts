#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { MemoryService } from "../services/memory-service.js";

interface ParsedArguments {
  command: string;
  databaseArguments: string[];
  values: Map<string, string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-privacy preview --id MEMORY_ID",
    "  memtextual-privacy delete --id MEMORY_ID --reason TEXT --confirm MEMORY_ID",
    "  memtextual-privacy restore --id MEMORY_ID --confirm MEMORY_ID",
    "  memtextual-privacy purge --id MEMORY_ID --reason TEXT --confirm MEMORY_ID",
    "",
    "All commands also accept --database PATH and --migrations PATH.",
    "Archive is the default reversible removal. Delete is recoverable; purge is not.",
    "Purge does not modify retained source records, snapshots, exports, or other backups.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...rest] = argv;
  if (command === undefined || command.startsWith("--")) {
    throw new Error(usage());
  }
  const databaseArguments: string[] = [];
  const values = new Map<string, string>();
  const valueOptions = new Set([
    "--database",
    "--migrations",
    "--id",
    "--reason",
    "--confirm",
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]!;
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    index += 1;
    if (option === "--database" || option === "--migrations") {
      databaseArguments.push(option, value);
    } else {
      values.set(option, value);
    }
  }
  return { command, databaseArguments, values };
}

function requiredValue(arguments_: ParsedArguments, option: string): string {
  const value = arguments_.values.get(option)?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`The ${arguments_.command} command requires ${option}.`);
  }
  return value;
}

function requireConfirmation(arguments_: ParsedArguments, id: string): void {
  if (requiredValue(arguments_, "--confirm") !== id) {
    throw new Error("--confirm must exactly match --id.");
  }
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(): void {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = resolveMcpRuntimeConfig({ argv: arguments_.databaseArguments });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });
  try {
    const service = new MemoryService(new SqliteMemoryRepository(database));
    const id = requiredValue(arguments_, "--id");
    switch (arguments_.command) {
      case "preview":
        writeJson(service.previewPurge(id));
        return;
      case "delete":
        requireConfirmation(arguments_, id);
        writeJson(
          service.delete(
            id,
            { reason: requiredValue(arguments_, "--reason") },
            { actor: "user", explicitUserAction: true },
          ),
        );
        return;
      case "restore":
        requireConfirmation(arguments_, id);
        writeJson(
          service.restoreDeleted(id, {
            actor: "user",
            explicitUserAction: true,
          }),
        );
        return;
      case "purge":
        requireConfirmation(arguments_, id);
        writeJson(
          service.purge(
            id,
            {
              reason: requiredValue(arguments_, "--reason"),
              confirmation: id,
            },
            { actor: "user", explicitUserAction: true },
          ),
        );
        return;
      default:
        throw new Error(`Unknown command: ${arguments_.command}\n\n${usage()}`);
    }
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown privacy command error";
  console.error(`MemTextual privacy command failed: ${message}`);
  process.exitCode = 1;
}
