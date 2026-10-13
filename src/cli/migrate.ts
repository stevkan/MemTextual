#!/usr/bin/env node

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { IngestionService } from "../services/ingestion-service.js";
import {
  LegacyMemoryMigrationService,
  parseLegacyMemoryExport,
} from "../services/legacy-memory-migration-service.js";

interface MigrationArguments {
  file: string;
  scopeId?: string;
  databaseArguments: string[];
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-migrate --file LEGACY.json [--scope ID]",
    "",
    "Use --scope as the default for entries that do not provide scopeId.",
    "The command also accepts --database PATH and --migrations PATH.",
  ].join("\n");
}

function parseArguments(argv: string[]): MigrationArguments {
  const values = new Map<string, string>();
  const databaseArguments: string[] = [];
  const supported = new Set(["--file", "--scope", "--database", "--migrations"]);

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!supported.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = argv[index + 1];
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

  const file = values.get("--file");
  if (file === undefined) {
    throw new Error(`The migration requires --file.\n\n${usage()}`);
  }
  const scopeId = values.get("--scope");
  return {
    file,
    databaseArguments,
    ...(scopeId === undefined ? {} : { scopeId }),
  };
}

function main(): void {
  const arguments_ = parseArguments(process.argv.slice(2));
  const input = parseLegacyMemoryExport(
    JSON.parse(readFileSync(resolve(arguments_.file), "utf8")) as unknown,
  );
  const config = resolveMcpRuntimeConfig({ argv: arguments_.databaseArguments });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });

  try {
    const memoryRepository = new SqliteMemoryRepository(database);
    const ingestion = new IngestionService(
      new SqliteIngestionRepository(database, memoryRepository),
    );
    const migration = new LegacyMemoryMigrationService(
      ingestion,
      memoryRepository,
    );
    const result = migration.migrate(input, {
      ...(arguments_.scopeId === undefined
        ? {}
        : { defaultScopeId: arguments_.scopeId }),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(`MemTextual migration failed: ${message}`);
  process.exitCode = 1;
}
