#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentEnvironment,
  validateWindowsContinuityDeploymentPlan,
} from "../platform/windows-continuity-deployment.js";
import {
  WindowsPowerShellHostOperations,
  createWindowsPowerShellBridge,
  validateWindowsManagedSchedule,
} from "../platform/windows-powershell-host-operations.js";
import {
  applyWindowsElevatedHostValidation,
  previewWindowsElevatedHostValidation,
} from "../services/windows-elevated-host-validation-service.js";

interface Arguments {
  actorId?: string;
  command: "apply" | "preview";
  configurationPath: string;
  confirmation?: string;
  workspaceDirectory: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-windows-host-validation preview --config DEPLOYMENT.json --workspace RELEASE_VALIDATION_WORKSPACE",
    "  memtextual-windows-host-validation apply --config DEPLOYMENT.json --workspace RELEASE_VALIDATION_WORKSPACE --confirm TOKEN --actor ACTOR_ID",
    "",
    "Preview is read-only. Apply must run in an elevated Windows terminal and",
    "installs, exercises, accepts, and removes only disposable validation resources.",
  ].join("\n");
}

export function parseWindowsElevatedHostValidationArguments(
  argv: readonly string[],
): Arguments {
  const command = argv[0];
  if (command !== "preview" && command !== "apply") {
    throw new Error(`Unknown or missing command.\n\n${usage()}`);
  }
  const allowed = new Set(["--actor", "--config", "--confirm", "--workspace"]);
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}.\n\n${usage()}`);
    }
    if (values.has(option)) throw new Error(`Duplicate argument: ${option}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  const configurationPath = values.get("--config")?.trim();
  const workspaceDirectory = values.get("--workspace")?.trim();
  if (!configurationPath || !workspaceDirectory) {
    throw new Error(`--config and --workspace are required.\n\n${usage()}`);
  }
  const confirmation = values.get("--confirm")?.trim();
  const actorId = values.get("--actor")?.trim();
  if (command === "apply" && (!confirmation || !actorId)) {
    throw new Error("apply requires --confirm and --actor.");
  }
  if (command === "preview" && (confirmation !== undefined || actorId !== undefined)) {
    throw new Error("preview does not accept --confirm or --actor.");
  }
  return {
    command,
    configurationPath,
    workspaceDirectory,
    ...(actorId === undefined ? {} : { actorId }),
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

export async function runWindowsElevatedHostValidationCli(
  argv: readonly string[],
): Promise<unknown> {
  if (process.platform !== "win32") {
    throw new Error("Elevated Windows host validation requires Windows.");
  }
  const arguments_ = parseWindowsElevatedHostValidationArguments(argv);
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
  const common = {
    operations,
    plan,
    scheduleValidator: (scheduleId: string) =>
      validateWindowsManagedSchedule(bridge, scheduleId),
    workspaceDirectory: arguments_.workspaceDirectory,
  };
  if (arguments_.command === "preview") {
    return previewWindowsElevatedHostValidation(common);
  }
  validateWindowsContinuityDeploymentEnvironment(plan);
  return applyWindowsElevatedHostValidation({
    ...common,
    confirmation: arguments_.confirmation!,
    context: {
      actorId: arguments_.actorId!,
      explicitUserAction: true,
    },
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (isEntrypoint) {
  runWindowsElevatedHostValidationCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown validation error";
      process.stderr.write(`MemTextual elevated host validation failed: ${message}\n`);
      process.exitCode = 1;
    });
}
