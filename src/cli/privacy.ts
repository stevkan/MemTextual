#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { sourceKinds, type SourceSeriesIdentity } from "../domain/ingestion.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { IngestionService } from "../services/ingestion-service.js";
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
    "  memtextual-privacy source-preview --kind KIND --external-id ID",
    "  memtextual-privacy source-delete --kind KIND --external-id ID --reason TEXT --confirm ID",
    "  memtextual-privacy source-restore --kind KIND --external-id ID --confirm ID",
    "  memtextual-privacy source-purge --kind KIND --external-id ID --reason TEXT --confirm ID",
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
    "--kind",
    "--external-id",
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

function sourceIdentity(arguments_: ParsedArguments): SourceSeriesIdentity {
  const kind = requiredValue(arguments_, "--kind");
  if (!sourceKinds.includes(kind as (typeof sourceKinds)[number])) {
    throw new Error(`Unsupported source kind: ${kind}.`);
  }
  return {
    kind: kind as SourceSeriesIdentity["kind"],
    externalId: requiredValue(arguments_, "--external-id"),
  };
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
    const memoryRepository = new SqliteMemoryRepository(database);
    const service = new MemoryService(memoryRepository);
    const ingestionService = new IngestionService(
      new SqliteIngestionRepository(database, memoryRepository),
    );
    switch (arguments_.command) {
      case "preview": {
        const id = requiredValue(arguments_, "--id");
        writeJson(service.previewPurge(id));
        return;
      }
      case "delete": {
        const id = requiredValue(arguments_, "--id");
        requireConfirmation(arguments_, id);
        writeJson(
          service.delete(
            id,
            { reason: requiredValue(arguments_, "--reason") },
            { actor: "user", explicitUserAction: true },
          ),
        );
        return;
      }
      case "restore": {
        const id = requiredValue(arguments_, "--id");
        requireConfirmation(arguments_, id);
        writeJson(
          service.restoreDeleted(id, {
            actor: "user",
            explicitUserAction: true,
          }),
        );
        return;
      }
      case "purge": {
        const id = requiredValue(arguments_, "--id");
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
      }
      case "source-preview":
        writeJson(ingestionService.previewSourceSeriesPurge(sourceIdentity(arguments_)));
        return;
      case "source-delete": {
        const identity = sourceIdentity(arguments_);
        requireConfirmation(arguments_, identity.externalId);
        writeJson(
          ingestionService.deleteSourceSeries(
            {
              ...identity,
              reason: requiredValue(arguments_, "--reason"),
            },
            { actor: "user", explicitUserAction: true },
          ),
        );
        return;
      }
      case "source-restore": {
        const identity = sourceIdentity(arguments_);
        requireConfirmation(arguments_, identity.externalId);
        writeJson(
          ingestionService.restoreSourceSeries(identity, {
            actor: "user",
            explicitUserAction: true,
          }),
        );
        return;
      }
      case "source-purge": {
        const identity = sourceIdentity(arguments_);
        requireConfirmation(arguments_, identity.externalId);
        writeJson(
          ingestionService.purgeSourceSeries(
            {
              ...identity,
              reason: requiredValue(arguments_, "--reason"),
              confirmation: identity.externalId,
            },
            { actor: "user", explicitUserAction: true },
          ),
        );
        return;
      }
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
