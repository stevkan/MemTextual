#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteContinuityControlRepository } from "../repositories/sqlite-continuity-control-repository.js";
import { SqliteContinuityMemoryRepository } from "../repositories/sqlite-continuity-memory-repository.js";
import { SqliteContinuityPersonaBehaviorRepository } from "../repositories/sqlite-continuity-persona-behavior-repository.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { ContinuityControlService } from "../services/continuity-control-service.js";
import { ContinuityMemoryService } from "../services/continuity-memory-service.js";
import { ContinuityPersonaBehaviorService } from "../services/continuity-persona-behavior-service.js";
import { IngestionService } from "../services/ingestion-service.js";
import { MemoryService } from "../services/memory-service.js";
import { startContinuityConsole } from "../ui/continuity-console.js";

interface ParsedArguments {
  databaseArguments: string[];
  personaId: string;
  port: number;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity --persona PERSONA_ID [--port PORT]",
    "",
    "Also accepts --database PATH and --migrations PATH.",
    "The console binds only to 127.0.0.1 and prints a one-time launch URL.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const values = new Map<string, string>();
  const databaseArguments: string[] = [];
  const allowed = new Set(["--persona", "--port", "--database", "--migrations"]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.\n\n${usage()}`);
    }
    index += 1;
    if (option === "--database" || option === "--migrations") {
      databaseArguments.push(option, value);
    } else {
      values.set(option, value);
    }
  }
  const personaId = values.get("--persona")?.trim();
  if (personaId === undefined || personaId.length === 0) {
    throw new Error(`--persona is required.\n\n${usage()}`);
  }
  const portText = values.get("--port") ?? "0";
  if (!/^\d{1,5}$/u.test(portText)) {
    throw new Error("--port must be an integer from 0 through 65535.");
  }
  const port = Number(portText);
  if (port > 65_535) {
    throw new Error("--port must be an integer from 0 through 65535.");
  }
  return { databaseArguments, personaId, port };
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = resolveMcpRuntimeConfig({ argv: arguments_.databaseArguments });
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const personaRepository = new SqlitePersonaRepository(database);
  const personaContext = personaRepository.getPersonaContext(arguments_.personaId);
  if (personaContext === null) {
    database.close();
    throw new Error(`Persona not found: ${arguments_.personaId}`);
  }
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const continuityMemories = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memoryRepository),
  );
  const control = new ContinuityControlService(
    new SqliteContinuityControlRepository(database),
    personaRepository,
    continuityMemories,
    new MemoryService(memoryRepository),
    ingestion,
  );
  const behaviors = new ContinuityPersonaBehaviorService(
    new SqliteContinuityPersonaBehaviorRepository(database),
  );
  let handle;
  try {
    handle = await startContinuityConsole({
      behaviors,
      control,
      personaContext,
      port: arguments_.port,
    });
  } catch (error) {
    database.close();
    throw error;
  }
  process.stdout.write("MemTextual Continuity control console is ready.\n");
  process.stdout.write(`${handle.launchUrl}\n`);
  process.stdout.write("Keep this URL private. Press Ctrl+C to stop the console.\n");

  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await handle.close();
    database.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown console error";
  process.stderr.write(`MemTextual Continuity console failed: ${message}\n`);
  process.exitCode = 1;
});
