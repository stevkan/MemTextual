#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContinuityReleaseCandidate } from "../services/continuity-release-validation-service.js";

interface Arguments {
  baselineMigrationsDirectory: string;
  bundleDirectory: string;
  trustedCertificateFingerprint256: string;
  workspaceDirectory: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-release validate --bundle DIRECTORY --trusted-fingerprint SHA256 --baseline-migrations DIRECTORY --workspace ABSENT_ABSOLUTE_DIRECTORY",
    "",
    "Runs the non-privileged Windows release lifecycle using synthetic data only.",
    "Dedicated-account and Task Scheduler validation is intentionally not run.",
  ].join("\n");
}

export function parseContinuityReleaseValidationArguments(argv: readonly string[]): Arguments {
  if (argv[0] !== "validate") {
    throw new Error(`Expected validate.\n\n${usage()}`);
  }
  const allowed = new Set([
    "--baseline-migrations",
    "--bundle",
    "--trusted-fingerprint",
    "--workspace",
  ]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) throw new Error(`Unknown argument: ${option}.\n\n${usage()}`);
    if (values.has(option)) throw new Error(`Duplicate argument: ${option}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  const baselineMigrationsDirectory = values.get("--baseline-migrations")?.trim();
  const bundleDirectory = values.get("--bundle")?.trim();
  const trustedCertificateFingerprint256 = values.get("--trusted-fingerprint")?.trim();
  const workspaceDirectory = values.get("--workspace")?.trim();
  if (!baselineMigrationsDirectory || !bundleDirectory || !trustedCertificateFingerprint256 || !workspaceDirectory) {
    throw new Error(`All release-validation arguments are required.\n\n${usage()}`);
  }
  return { baselineMigrationsDirectory, bundleDirectory, trustedCertificateFingerprint256, workspaceDirectory };
}

export async function runContinuityReleaseValidationCli(argv: readonly string[]): Promise<unknown> {
  return validateContinuityReleaseCandidate(parseContinuityReleaseValidationArguments(argv));
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runContinuityReleaseValidationCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown validation error";
      process.stderr.write(`MemTextual Continuity release validation failed: ${message}\n`);
      process.exitCode = 1;
    });
}
