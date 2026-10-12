#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqliteReviewPolicyRepository } from "../repositories/sqlite-review-policy-repository.js";
import { IngestionService } from "../services/ingestion-service.js";
import { MemoryService } from "../services/memory-service.js";
import { ReviewAutomationService } from "../services/review-automation-service.js";
import { resolveMcpRuntimeConfig } from "./config.js";
import { createMemTextualMcpServer } from "./server.js";

function main(): void {
  const config = resolveMcpRuntimeConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });

  const database = openMemTextualDatabase({
    filename: config.databasePath,
    migrationsDirectory: config.migrationsDirectory,
  });
  const repository = new SqliteMemoryRepository(database);
  const service = new MemoryService(repository);
  const ingestionRepository = new SqliteIngestionRepository(database, repository);
  const reviewAutomation = new ReviewAutomationService(
    ingestionRepository,
    new SqliteReviewPolicyRepository(database, ingestionRepository),
  );
  const ingestionService = new IngestionService(
    ingestionRepository,
    reviewAutomation,
  );

  serveStdio(
    () => {
      const server = createMemTextualMcpServer(service, ingestionService);
      server.server.onclose = () => {
        if (database.open) {
          database.close();
        }
      };
      return server;
    },
    {
      onerror: (error) => console.error(`MemTextual MCP error: ${error.message}`),
    },
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`MemTextual MCP failed to start: ${message}`);
  process.exitCode = 1;
}
