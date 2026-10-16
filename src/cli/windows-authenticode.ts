#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WindowsSignToolOperations,
  applyWindowsAuthenticodeSigning,
  previewWindowsAuthenticodeSigning,
  type WindowsCertificateStore,
} from "../packaging/windows-authenticode.js";

interface Arguments {
  certificateStore: WindowsCertificateStore;
  certificateThumbprint: string;
  command: "apply" | "preview";
  confirmation?: string;
  signedArtifactPath: string;
  signToolPath: string;
  timestampUrl: string;
  unsignedArtifactPath: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-windows-authenticode preview --unsigned UNSIGNED_INSTALLER --signed SIGNED_INSTALLER --signtool SIGNTOOL.exe --certificate-thumbprint SHA1 --certificate-store current-user|local-machine --timestamp-url HTTPS_URL",
    "  memtextual-windows-authenticode apply --unsigned UNSIGNED_INSTALLER --signed SIGNED_INSTALLER --signtool SIGNTOOL.exe --certificate-thumbprint SHA1 --certificate-store current-user|local-machine --timestamp-url HTTPS_URL --confirm TOKEN",
    "",
    "Preview is read-only. Apply creates a new output and never overwrites the unsigned artifact.",
  ].join("\n");
}

export function parseWindowsAuthenticodeArguments(argv: readonly string[]): Arguments {
  const command = argv[0];
  if (command !== "preview" && command !== "apply") {
    throw new Error(`Unknown or missing command.\n\n${usage()}`);
  }
  const allowed = new Set([
    "--certificate-store",
    "--certificate-thumbprint",
    "--confirm",
    "--signed",
    "--signtool",
    "--timestamp-url",
    "--unsigned",
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
  const required = [
    "--certificate-store",
    "--certificate-thumbprint",
    "--signed",
    "--signtool",
    "--timestamp-url",
    "--unsigned",
  ];
  for (const option of required) {
    if (!values.get(option)?.trim()) throw new Error(`${option} is required.`);
  }
  const certificateStore = values.get("--certificate-store")!;
  if (certificateStore !== "current-user" && certificateStore !== "local-machine") {
    throw new Error("--certificate-store must be current-user or local-machine.");
  }
  const confirmation = values.get("--confirm")?.trim();
  if (command === "apply" && !confirmation) throw new Error("apply requires --confirm.");
  if (command === "preview" && confirmation !== undefined) {
    throw new Error("preview does not accept --confirm.");
  }
  return {
    certificateStore,
    certificateThumbprint: values.get("--certificate-thumbprint")!,
    command,
    signedArtifactPath: values.get("--signed")!,
    signToolPath: values.get("--signtool")!,
    timestampUrl: values.get("--timestamp-url")!,
    unsignedArtifactPath: values.get("--unsigned")!,
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

export async function runWindowsAuthenticodeCli(argv: readonly string[]): Promise<unknown> {
  if (process.platform !== "win32") {
    throw new Error("Windows Authenticode signing requires Windows.");
  }
  const arguments_ = parseWindowsAuthenticodeArguments(argv);
  const operations = new WindowsSignToolOperations({
    signToolPath: arguments_.signToolPath,
  });
  const common = {
    certificateStore: arguments_.certificateStore,
    certificateThumbprint: arguments_.certificateThumbprint,
    operations,
    signedArtifactPath: arguments_.signedArtifactPath,
    signToolPath: arguments_.signToolPath,
    timestampUrl: arguments_.timestampUrl,
    unsignedArtifactPath: arguments_.unsignedArtifactPath,
  };
  if (arguments_.command === "preview") return previewWindowsAuthenticodeSigning(common);
  return applyWindowsAuthenticodeSigning({
    ...common,
    confirmation: arguments_.confirmation!,
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runWindowsAuthenticodeCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown Authenticode error";
      process.stderr.write(`MemTextual Authenticode signing failed: ${message}\n`);
      process.exitCode = 1;
    });
}
