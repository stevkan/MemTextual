#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WindowsWixOperations, applyWindowsMsiBuild, previewWindowsMsiBuild } from "../packaging/windows-msi.js";

interface Arguments {
  bundleDirectory: string;
  command: "apply" | "preview";
  confirmation?: string;
  manufacturer: string;
  outputPath: string;
  trustedFingerprint: string;
  wixEulaAccepted: true;
  wixExecutablePath: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-windows-msi preview --bundle BUNDLE --output UNSIGNED.msi --wix WIX.exe --manufacturer RELEASE_OWNER --trusted-fingerprint SHA256 --accept-wix-eula",
    "  memtextual-windows-msi apply --bundle BUNDLE --output UNSIGNED.msi --wix WIX.exe --manufacturer RELEASE_OWNER --trusted-fingerprint SHA256 --accept-wix-eula --confirm TOKEN",
    "",
    "WiX 7 is user-supplied. --accept-wix-eula records explicit acceptance for this invocation; MemTextual does not download or license WiX.",
  ].join("\n");
}

export function parseWindowsMsiArguments(argv: readonly string[]): Arguments {
  const command = argv[0];
  if (command !== "preview" && command !== "apply") throw new Error(`Unknown or missing command.\n\n${usage()}`);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const valueOptions = new Set(["--bundle", "--confirm", "--manufacturer", "--output", "--trusted-fingerprint", "--wix"]);
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === "--accept-wix-eula") {
      if (flags.has(option)) throw new Error(`Duplicate argument: ${option}.`);
      flags.add(option);
      continue;
    }
    if (!valueOptions.has(option)) throw new Error(`Unknown argument: ${option}.\n\n${usage()}`);
    if (values.has(option)) throw new Error(`Duplicate argument: ${option}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}.`);
    values.set(option, value);
    index += 1;
  }
  for (const option of ["--bundle", "--manufacturer", "--output", "--trusted-fingerprint", "--wix"]) {
    if (!values.get(option)?.trim()) throw new Error(`${option} is required.`);
  }
  if (!flags.has("--accept-wix-eula")) throw new Error("Explicit --accept-wix-eula is required.");
  const confirmation = values.get("--confirm")?.trim();
  if (command === "apply" && !confirmation) throw new Error("apply requires --confirm.");
  if (command === "preview" && confirmation !== undefined) throw new Error("preview does not accept --confirm.");
  return {
    bundleDirectory: values.get("--bundle")!, command, manufacturer: values.get("--manufacturer")!,
    outputPath: values.get("--output")!, trustedFingerprint: values.get("--trusted-fingerprint")!,
    wixEulaAccepted: true, wixExecutablePath: values.get("--wix")!,
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

export async function runWindowsMsiCli(argv: readonly string[]): Promise<unknown> {
  if (process.platform !== "win32") throw new Error("Windows MSI creation requires Windows.");
  const input = parseWindowsMsiArguments(argv);
  const operations = new WindowsWixOperations(input.wixExecutablePath);
  const common = {
    bundleDirectory: input.bundleDirectory, manufacturer: input.manufacturer, operations,
    outputPath: input.outputPath, trustedCertificateFingerprint256: input.trustedFingerprint,
    wixEulaAccepted: true as const, wixExecutablePath: input.wixExecutablePath,
  };
  return input.command === "preview"
    ? previewWindowsMsiBuild(common)
    : applyWindowsMsiBuild({ ...common, confirmation: input.confirmation! });
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isEntrypoint) runWindowsMsiCli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error: unknown) => {
  process.stderr.write(`MemTextual Windows MSI build failed: ${error instanceof Error ? error.message : "Unknown MSI error"}\n`);
  process.exitCode = 1;
});
