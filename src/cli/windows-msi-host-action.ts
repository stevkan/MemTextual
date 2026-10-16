#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWindowsContinuityDeploymentPlan,
  loadWindowsContinuityDeploymentConfiguration,
  validateWindowsContinuityDeploymentEnvironment,
  validateWindowsContinuityDeploymentPlan,
} from "../platform/windows-continuity-deployment.js";
import { WindowsPowerShellHostOperations, createWindowsPowerShellBridge } from "../platform/windows-powershell-host-operations.js";
import { executeWindowsMsiHostAction, windowsMsiHostActions, type WindowsMsiHostAction } from "../services/windows-msi-host-action-service.js";

export function parseWindowsMsiHostActionArguments(argv: readonly string[]): { action: WindowsMsiHostAction; configurationPath: string } {
  const action = argv[0];
  if (!windowsMsiHostActions.includes(action as WindowsMsiHostAction)) throw new Error("Unknown or missing MSI host action.");
  if (argv.length !== 3 || argv[1] !== "--config" || !argv[2]?.trim()) throw new Error("MSI host action requires exactly --config DEPLOYMENT.json.");
  return { action: action as WindowsMsiHostAction, configurationPath: argv[2] };
}

export async function runWindowsMsiHostActionCli(argv: readonly string[]): Promise<unknown> {
  if (process.platform !== "win32") throw new Error("MSI host actions require Windows.");
  const input = parseWindowsMsiHostActionArguments(argv);
  const deployment = loadWindowsContinuityDeploymentConfiguration(input.configurationPath);
  const plan = createWindowsContinuityDeploymentPlan(deployment);
  validateWindowsContinuityDeploymentPlan(plan);
  if (input.action === "install" || input.action === "rollback-uninstall") validateWindowsContinuityDeploymentEnvironment(plan);
  const bridge = createWindowsPowerShellBridge({ scriptPath: plan.executorScriptPath, stateDirectory: deployment.stateDirectory });
  return executeWindowsMsiHostAction({
    action: input.action,
    configuration: plan.host,
    operations: new WindowsPowerShellHostOperations({ bridge }),
  });
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isEntrypoint) runWindowsMsiHostActionCli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
  process.stderr.write(`MemTextual MSI host action failed: ${error instanceof Error ? error.message : "Unknown MSI host-action error"}\n`);
  process.exitCode = 1;
});
