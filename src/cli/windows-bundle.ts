#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWindowsContinuityBundleStage,
  createWindowsContinuityBundle,
  previewWindowsContinuityBundleStage,
  verifyWindowsContinuityBundle,
} from "../packaging/windows-continuity-bundle.js";

type WindowsBundleCommand =
  | "create"
  | "stage-apply"
  | "stage-preview"
  | "verify";

interface WindowsBundleCliArguments {
  command: WindowsBundleCommand;
  values: ReadonlyMap<string, string>;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-windows-bundle create --source DIRECTORY --output DIRECTORY --runtime NODE.exe --runtime-license LICENSE --application-license LICENSE.txt --signing-key PRIVATE.pem --signing-certificate CERTIFICATE.pem",
    "  memtextual-windows-bundle verify --bundle DIRECTORY [--trusted-fingerprint SHA256]",
    "  memtextual-windows-bundle stage-preview --bundle DIRECTORY --target DIRECTORY --trusted-fingerprint SHA256",
    "  memtextual-windows-bundle stage-apply --bundle DIRECTORY --target DIRECTORY --trusted-fingerprint SHA256 --confirm TOKEN",
    "",
    "Creation requires a completed production build and installed production",
    "dependencies. Staging never overwrites an existing target directory.",
  ].join("\n");
}

const optionsByCommand: Record<WindowsBundleCommand, ReadonlySet<string>> = {
  create: new Set([
    "--application-license",
    "--output",
    "--runtime",
    "--runtime-license",
    "--signing-certificate",
    "--signing-key",
    "--source",
  ]),
  verify: new Set(["--bundle", "--trusted-fingerprint"]),
  "stage-preview": new Set([
    "--bundle",
    "--target",
    "--trusted-fingerprint",
  ]),
  "stage-apply": new Set([
    "--bundle",
    "--confirm",
    "--target",
    "--trusted-fingerprint",
  ]),
};

export function parseWindowsBundleCliArguments(
  argv: readonly string[],
): WindowsBundleCliArguments {
  const command = argv[0];
  if (
    command !== "create" &&
    command !== "verify" &&
    command !== "stage-preview" &&
    command !== "stage-apply"
  ) {
    throw new Error(`Unknown or missing command.\n\n${usage()}`);
  }
  const allowed = optionsByCommand[command];
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument for ${command}: ${option}.`);
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
  for (const required of allowed) {
    if (command === "verify" && required === "--trusted-fingerprint") continue;
    if (!values.has(required)) {
      throw new Error(`${required} is required for ${command}.\n\n${usage()}`);
    }
  }
  return { command, values };
}

function requiredValue(
  arguments_: WindowsBundleCliArguments,
  name: string,
): string {
  return arguments_.values.get(name)!;
}

export async function runWindowsBundleCli(
  argv: readonly string[],
): Promise<unknown> {
  const arguments_ = parseWindowsBundleCliArguments(argv);
  if (arguments_.command === "create") {
    if (process.platform !== "win32") {
      throw new Error("Windows bundle creation requires Windows.");
    }
    return createWindowsContinuityBundle({
      applicationLicensePath: requiredValue(
        arguments_,
        "--application-license",
      ),
      outputDirectory: requiredValue(arguments_, "--output"),
      runtimeExecutablePath: requiredValue(arguments_, "--runtime"),
      runtimeLicensePath: requiredValue(arguments_, "--runtime-license"),
      signingCertificatePath: requiredValue(
        arguments_,
        "--signing-certificate",
      ),
      signingPrivateKeyPath: requiredValue(arguments_, "--signing-key"),
      sourceDirectory: requiredValue(arguments_, "--source"),
    });
  }
  if (arguments_.command === "verify") {
    const fingerprint = arguments_.values.get("--trusted-fingerprint");
    return verifyWindowsContinuityBundle({
      bundleDirectory: requiredValue(arguments_, "--bundle"),
      ...(fingerprint === undefined
        ? {}
        : { trustedCertificateFingerprint256: fingerprint }),
    });
  }
  if (process.platform !== "win32") {
    throw new Error("Windows bundle staging requires Windows.");
  }
  const common = {
    bundleDirectory: requiredValue(arguments_, "--bundle"),
    targetDirectory: requiredValue(arguments_, "--target"),
    trustedCertificateFingerprint256: requiredValue(
      arguments_,
      "--trusted-fingerprint",
    ),
  };
  if (arguments_.command === "stage-preview") {
    return previewWindowsContinuityBundleStage(common);
  }
  return applyWindowsContinuityBundleStage({
    ...common,
    confirmation: requiredValue(arguments_, "--confirm"),
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runWindowsBundleCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown Windows bundle error";
      process.stderr.write(`MemTextual Windows bundle failed: ${message}\n`);
      process.exitCode = 1;
    });
}
