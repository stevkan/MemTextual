#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { IngestionService } from "../services/ingestion-service.js";
import { reviewPendingCandidates } from "./review-session.js";

async function main(): Promise<void> {
  const config = resolveMcpRuntimeConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const service = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });

  try {
    await reviewPendingCandidates(service, {
      ask: (prompt) => terminal.question(prompt),
      write: (message) => process.stdout.write(`${message}\n`),
    });
  } finally {
    terminal.close();
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown review error";
  console.error(`MemTextual review failed: ${message}`);
  process.exitCode = 1;
});
