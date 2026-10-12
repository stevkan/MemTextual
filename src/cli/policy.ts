#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SetReviewPolicyInput } from "../domain/review-policy.js";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import { resolveMcpRuntimeConfig } from "../mcp/config.js";
import { SqliteIngestionRepository } from "../repositories/sqlite-ingestion-repository.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqliteReviewPolicyRepository } from "../repositories/sqlite-review-policy-repository.js";
import { IngestionService } from "../services/ingestion-service.js";
import { ReviewAutomationService } from "../services/review-automation-service.js";

interface ParsedArguments {
  command: string;
  databaseArguments: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-policy list [--scope ID] [--all]",
    "  memtextual-policy set --file POLICY.json",
    "  memtextual-policy preview --candidate ID",
    "  memtextual-policy process --candidate ID",
    "  memtextual-policy process --pending [--limit N]",
    "  memtextual-policy bulk-accept --ids ID,ID [--note TEXT]",
    "  memtextual-policy bulk-reject --ids ID,ID [--note TEXT]",
    "",
    "All commands also accept --database PATH and --migrations PATH.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...rest] = argv;
  if (command === undefined || command.startsWith("--")) {
    throw new Error(usage());
  }
  const databaseArguments: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set([
    "--database",
    "--migrations",
    "--scope",
    "--file",
    "--candidate",
    "--limit",
    "--ids",
    "--note",
  ]);
  const flagOptions = new Set(["--all", "--pending"]);

  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]!;
    if (flagOptions.has(option)) {
      flags.add(option);
      continue;
    }
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
  return { command, databaseArguments, values, flags };
}

function requiredValue(arguments_: ParsedArguments, option: string): string {
  const value = arguments_.values.get(option);
  if (value === undefined) {
    throw new Error(`The ${arguments_.command} command requires ${option}.`);
  }
  return value;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readPolicyFile(path: string): SetReviewPolicyInput {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A policy file must contain one JSON object.");
  }
  return parsed as SetReviewPolicyInput;
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
    const ingestionRepository = new SqliteIngestionRepository(
      database,
      memoryRepository,
    );
    const automation = new ReviewAutomationService(
      ingestionRepository,
      new SqliteReviewPolicyRepository(database, ingestionRepository),
    );
    const ingestionService = new IngestionService(
      ingestionRepository,
      automation,
    );

    switch (arguments_.command) {
      case "list":
        writeJson(
          automation.listPolicies(
            arguments_.values.get("--scope"),
            arguments_.flags.has("--all"),
          ),
        );
        return;
      case "set":
        writeJson(
          automation.setPolicy(readPolicyFile(requiredValue(arguments_, "--file")), {
            actor: "user",
            explicitUserAction: true,
          }),
        );
        return;
      case "preview":
        writeJson(
          automation.previewCandidate(requiredValue(arguments_, "--candidate")),
        );
        return;
      case "process": {
        const candidateId = arguments_.values.get("--candidate");
        if (candidateId !== undefined && arguments_.flags.has("--pending")) {
          throw new Error("Choose either --candidate or --pending, not both.");
        }
        if (candidateId !== undefined) {
          writeJson(automation.processCandidate(candidateId));
          return;
        }
        if (!arguments_.flags.has("--pending")) {
          throw new Error("The process command requires --candidate or --pending.");
        }
        const limitText = arguments_.values.get("--limit") ?? "100";
        const limit = Number.parseInt(limitText, 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new Error("--limit must be an integer from 1 through 100.");
        }
        writeJson(automation.processPending(limit));
        return;
      }
      case "bulk-accept":
      case "bulk-reject": {
        const ids = requiredValue(arguments_, "--ids")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
        const note = arguments_.values.get("--note");
        writeJson(
          ingestionService.bulkReviewCandidates(
            ids,
            arguments_.command === "bulk-accept" ? "accept" : "reject",
            {
              actor: "user",
              explicitUserAction: true,
              ...(note === undefined ? {} : { note }),
            },
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
  const message = error instanceof Error ? error.message : "Unknown policy error";
  console.error(`MemTextual policy failed: ${message}`);
  process.exitCode = 1;
}
