#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  createDatabaseSnapshot,
  verifyDatabaseAgainstManifest,
} from "../safeguards/database-safeguard.js";

function usage(): string {
  return [
    "Usage:",
    "  memtextual-safeguard snapshot --database PATH --output DIRECTORY",
    "  memtextual-safeguard verify --database PATH --manifest PATH",
  ].join("\n");
}

function optionValue(arguments_: string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name} option.\n\n${usage()}`);
  }
  return value;
}

async function main(arguments_: string[]): Promise<void> {
  const command = arguments_[0];
  if (command === "snapshot") {
    const databasePath = resolve(optionValue(arguments_, "--database"));
    const outputDirectory = resolve(optionValue(arguments_, "--output"));
    const result = await createDatabaseSnapshot({ databasePath, outputDirectory });
    console.log(`Snapshot created: ${result.backupPath}`);
    console.log(`Manifest created: ${result.manifestPath}`);
    console.log(`Durable data export created: ${result.exportPath}`);
    console.log(
      `Protected tables recorded: ${Object.keys(result.manifest.protectedTables).length}`,
    );
    return;
  }

  if (command === "verify") {
    const databasePath = resolve(optionValue(arguments_, "--database"));
    const manifestPath = resolve(optionValue(arguments_, "--manifest"));
    const result = verifyDatabaseAgainstManifest({
      databasePath,
      manifestPath,
    });
    const verifiedAt = new Date().toISOString();
    const reportPath = join(
      dirname(manifestPath),
      `verification-report-${verifiedAt.replaceAll(":", "-").replace(".", "-")}.json`,
    );
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          ...result,
          database: basename(databasePath),
          manifest: basename(manifestPath),
          manifestSha256: createHash("sha256")
            .update(readFileSync(manifestPath))
            .digest("hex"),
          verifiedAt,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    if (!result.passed) {
      throw new Error(
        `Safeguard verification failed; report: ${reportPath}\n- ${result.problems.join("\n- ")}`,
      );
    }
    console.log(`Safeguard verification passed for ${result.checkedTables} tables.`);
    console.log(`Verification report created: ${reportPath}`);
    return;
  }

  throw new Error(`Unknown or missing command.\n\n${usage()}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown safeguard error";
  console.error(`MemTextual safeguard failed: ${message}`);
  process.exitCode = 1;
});
