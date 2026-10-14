#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWindowsHostInstallation,
  applyWindowsHostRemoval,
  previewWindowsHostInstallation,
  previewWindowsHostRemoval,
} from "../platform/windows-host-integration.js";
import {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentEnvironment,
  validateWindowsContinuityDeploymentPlan,
} from "../platform/windows-continuity-deployment.js";
import {
  WindowsPowerShellHostOperations,
  createWindowsPowerShellBridge,
} from "../platform/windows-powershell-host-operations.js";

interface WindowsHostCliArguments {
  actorId?: string;
  command: "install-apply" | "install-preview" | "remove-apply" | "remove-preview";
  configurationPath: string;
  confirmation?: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-windows-host install-preview --config DEPLOYMENT.json",
    "  memtextual-windows-host install-apply --config DEPLOYMENT.json --confirm TOKEN --actor ACTOR_ID",
    "  memtextual-windows-host remove-preview --config DEPLOYMENT.json",
    "  memtextual-windows-host remove-apply --config DEPLOYMENT.json --confirm TOKEN --actor ACTOR_ID",
    "",
    "Preview commands are read-only. Apply commands must run in an elevated",
    "Windows terminal and require the exact fresh confirmation token.",
  ].join("\n");
}

export function parseWindowsHostCliArguments(
  argv: readonly string[],
): WindowsHostCliArguments {
  const command = argv[0];
  if (
    command !== "install-preview" &&
    command !== "install-apply" &&
    command !== "remove-preview" &&
    command !== "remove-apply"
  ) {
    throw new Error(`Unknown or missing command.\n\n${usage()}`);
  }
  const allowed = new Set(["--actor", "--config", "--confirm"]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
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
  const configurationPath = values.get("--config");
  if (configurationPath === undefined) {
    throw new Error(`--config is required.\n\n${usage()}`);
  }
  const applying = command.endsWith("-apply");
  const confirmation = values.get("--confirm");
  const actorId = values.get("--actor");
  if (applying && confirmation === undefined) {
    throw new Error(`--confirm is required for ${command}.`);
  }
  if (applying && actorId === undefined) {
    throw new Error(`--actor is required for ${command}.`);
  }
  if (!applying && (confirmation !== undefined || actorId !== undefined)) {
    throw new Error("Preview commands do not accept --confirm or --actor.");
  }
  return {
    command,
    configurationPath,
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(actorId === undefined ? {} : { actorId }),
  };
}

export async function runWindowsHostCli(
  argv: readonly string[],
): Promise<unknown> {
  if (process.platform !== "win32") {
    throw new Error("The MemTextual Windows host installer requires Windows.");
  }
  const arguments_ = parseWindowsHostCliArguments(argv);
  const deployment = loadWindowsContinuityDeploymentConfiguration(
    arguments_.configurationPath,
  );
  const plan = createWindowsContinuityDeploymentPlan(deployment);
  validateWindowsContinuityDeploymentPlan(plan);
  const bridge = createWindowsPowerShellBridge({
    scriptPath: plan.executorScriptPath,
    stateDirectory: deployment.stateDirectory,
  });
  const operations = new WindowsPowerShellHostOperations({ bridge });
  if (arguments_.command === "install-preview") {
    return previewWindowsHostInstallation(operations, plan.host);
  }
  if (arguments_.command === "remove-preview") {
    return previewWindowsHostRemoval(operations, plan.host);
  }
  const context = {
    actorId: arguments_.actorId!,
    explicitUserAction: true as const,
  };
  if (arguments_.command === "install-apply") {
    validateWindowsContinuityDeploymentEnvironment(plan);
    return applyWindowsHostInstallation(
      operations,
      plan.host,
      arguments_.confirmation!,
      context,
    );
  }
  return applyWindowsHostRemoval(
    operations,
    plan.host,
    arguments_.confirmation!,
    context,
  );
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runWindowsHostCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown Windows host error";
      process.stderr.write(`MemTextual Windows host installer failed: ${message}\n`);
      process.exitCode = 1;
    });
}
