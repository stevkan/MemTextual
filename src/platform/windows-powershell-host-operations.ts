import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { win32 } from "node:path";
import type {
  HostScheduleDefinition,
  HostServiceIdentityRequest,
  HostServiceIdentityState,
} from "./host-platform.js";
import type {
  WindowsHostOperations,
  WindowsManagedScheduleState,
  WindowsPathProtectionState,
  WindowsPathRestorationState,
  WindowsProtectedPath,
} from "./windows-host-integration.js";

export type WindowsPowerShellHostAction =
  | "inspect-identity"
  | "inspect-schedule"
  | "install-schedule"
  | "protect-paths"
  | "provision-identity"
  | "remove-identity"
  | "remove-schedule"
  | "restore-paths";

export interface WindowsPowerShellBridge {
  execute(action: WindowsPowerShellHostAction, payload: unknown): Promise<unknown>;
}

export interface WindowsPowerShellBridgeOptions {
  powershellPath?: string;
  scriptPath: string;
  stateDirectory: string;
  timeoutMs?: number;
}

export interface WindowsPowerShellHostOperationsOptions {
  bridge: WindowsPowerShellBridge;
  environment?: NodeJS.ProcessEnv;
}

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Windows PowerShell ${label} response must be an object.`);
  }
  return value as Record<string, unknown>;
}

function identityState(value: unknown): HostServiceIdentityState {
  const record = requireRecord(value, "identity");
  if (
    typeof record.identityName !== "string" ||
    !safeIdentifier.test(record.identityName) ||
    typeof record.available !== "boolean" ||
    typeof record.managedByMemTextual !== "boolean"
  ) {
    throw new Error("Windows PowerShell identity response is invalid.");
  }
  return {
    available: record.available,
    identityName: record.identityName,
    managedByMemTextual: record.managedByMemTextual,
  };
}

function scheduleDefinition(value: unknown): HostScheduleDefinition {
  const record = requireRecord(value, "schedule definition");
  const command = requireRecord(record.command, "scheduled command");
  if (
    typeof record.scheduleId !== "string" ||
    !safeIdentifier.test(record.scheduleId) ||
    !Number.isSafeInteger(record.intervalMinutes) ||
    Number(record.intervalMinutes) < 5 ||
    Number(record.intervalMinutes) > 1_440 ||
    typeof command.executablePath !== "string" ||
    !win32.isAbsolute(command.executablePath) ||
    typeof command.workingDirectory !== "string" ||
    !win32.isAbsolute(command.workingDirectory) ||
    !Array.isArray(command.arguments) ||
    !command.arguments.every((argument) => typeof argument === "string") ||
    !Array.isArray(command.environmentVariableNames) ||
    !command.environmentVariableNames.every(
      (name) =>
        typeof name === "string" &&
        /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name),
    )
  ) {
    throw new Error("Windows PowerShell schedule definition is invalid.");
  }
  return {
    command: {
      arguments: [...command.arguments] as string[],
      environmentVariableNames: [
        ...command.environmentVariableNames,
      ] as string[],
      executablePath: command.executablePath,
      workingDirectory: command.workingDirectory,
    },
    intervalMinutes: Number(record.intervalMinutes),
    scheduleId: record.scheduleId,
  };
}

function scheduleState(value: unknown): WindowsManagedScheduleState {
  const record = requireRecord(value, "schedule");
  if (
    typeof record.scheduleId !== "string" ||
    !safeIdentifier.test(record.scheduleId) ||
    typeof record.installed !== "boolean" ||
    typeof record.enabled !== "boolean" ||
    typeof record.managedByMemTextual !== "boolean"
  ) {
    throw new Error("Windows PowerShell schedule response is invalid.");
  }
  if (record.definition === undefined) {
    return {
      enabled: record.enabled,
      installed: record.installed,
      managedByMemTextual: record.managedByMemTextual,
      scheduleId: record.scheduleId,
    };
  }
  const definition = scheduleDefinition(record.definition);
  return {
    definition,
    enabled: record.enabled,
    installed: record.installed,
    managedByMemTextual: record.managedByMemTextual,
    scheduleId: record.scheduleId,
  };
}

function requireDirectFile(path: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file.`);
  }
}

export function createWindowsPowerShellBridge(
  options: WindowsPowerShellBridgeOptions,
): WindowsPowerShellBridge {
  if (process.platform !== "win32") {
    throw new Error("Windows PowerShell host operations require Windows.");
  }
  const scriptPath = win32.resolve(options.scriptPath);
  const stateDirectory = win32.resolve(options.stateDirectory);
  const powershellPath = win32.resolve(
    options.powershellPath ??
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  requireDirectFile(scriptPath, "Windows host executor script");
  requireDirectFile(powershellPath, "Windows PowerShell executable");
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error(
      "Windows host executor timeoutMs must be an integer from 1000 through 300000.",
    );
  }
  const actions = new Set<WindowsPowerShellHostAction>([
    "inspect-identity",
    "inspect-schedule",
    "install-schedule",
    "protect-paths",
    "provision-identity",
    "remove-identity",
    "remove-schedule",
    "restore-paths",
  ]);

  return {
    execute(action, payload) {
      return new Promise((resolvePromise, reject) => {
        if (!actions.has(action)) {
          reject(new Error("Windows host executor action is invalid."));
          return;
        }
        let request: string;
        try {
          request = JSON.stringify(payload);
        } catch {
          reject(new Error("Windows host executor request is not serializable."));
          return;
        }
        if (Buffer.byteLength(request, "utf8") > 1024 * 1024) {
          reject(new Error("Windows host executor request exceeds its size limit."));
          return;
        }
        const child = spawn(
          powershellPath,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-Action",
            action,
            "-StateDirectory",
            stateDirectory,
          ],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const outputLimit = 1024 * 1024;
        const finishReject = (error: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        };
        const timeout = setTimeout(() => {
          child.kill();
          finishReject(new Error("Windows host executor timed out."));
        }, timeoutMs);
        timeout.unref();
        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes <= outputLimit) stdout.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderrBytes += chunk.length;
          if (stderrBytes <= outputLimit) stderr.push(chunk);
        });
        child.on("error", (error) => finishReject(error));
        child.stdin.on("error", (error) => finishReject(error));
        child.on("close", (code) => {
          if (settled) return;
          clearTimeout(timeout);
          if (stdoutBytes > outputLimit || stderrBytes > outputLimit) {
            finishReject(
              new Error("Windows host executor exceeded its output limit."),
            );
            return;
          }
          const errorText = Buffer.concat(stderr).toString("utf8").trim();
          if (code !== 0) {
            finishReject(
              new Error(
                `Windows host executor failed${errorText.length === 0 ? "." : `: ${errorText}`}`,
              ),
            );
            return;
          }
          try {
            const value = JSON.parse(Buffer.concat(stdout).toString("utf8"));
            settled = true;
            resolvePromise(value);
          } catch {
            finishReject(
              new Error("Windows host executor returned invalid JSON."),
            );
          }
        });
        child.stdin.end(request, "utf8");
      });
    },
  };
}

export class WindowsPowerShellHostOperations implements WindowsHostOperations {
  readonly #bridge: WindowsPowerShellBridge;
  readonly #environment: NodeJS.ProcessEnv;

  constructor(options: WindowsPowerShellHostOperationsOptions) {
    this.#bridge = options.bridge;
    this.#environment = options.environment ?? process.env;
  }

  async inspectIdentity(identityName: string): Promise<HostServiceIdentityState> {
    return identityState(
      await this.#bridge.execute("inspect-identity", { identityName }),
    );
  }

  async inspectSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    return scheduleState(
      await this.#bridge.execute("inspect-schedule", { scheduleId }),
    );
  }

  async installSchedule(
    definition: HostScheduleDefinition,
    identityName: string,
  ): Promise<WindowsManagedScheduleState> {
    const environmentValues: Record<string, string> = {};
    for (const name of definition.command.environmentVariableNames) {
      const value = this.#environment[name];
      if (value === undefined || value.length === 0) {
        throw new Error(
          `Required scheduled environment variable is not set: ${name}.`,
        );
      }
      environmentValues[name] = value;
    }
    return scheduleState(
      await this.#bridge.execute("install-schedule", {
        definition,
        environmentValues,
        identityName,
      }),
    );
  }

  async protectPaths(
    paths: readonly WindowsProtectedPath[],
    identityName: string,
  ): Promise<WindowsPathProtectionState> {
    const response = requireRecord(
      await this.#bridge.execute("protect-paths", { identityName, paths }),
      "path protection",
    );
    if (response.protected !== true || typeof response.created !== "boolean") {
      throw new Error("Windows PowerShell did not confirm path protection.");
    }
    return { created: response.created, protected: true };
  }

  async provisionIdentity(
    request: HostServiceIdentityRequest,
  ): Promise<HostServiceIdentityState> {
    return identityState(
      await this.#bridge.execute("provision-identity", request),
    );
  }

  async removeIdentity(identityName: string): Promise<HostServiceIdentityState> {
    return identityState(
      await this.#bridge.execute("remove-identity", { identityName }),
    );
  }

  async removeSchedule(scheduleId: string): Promise<WindowsManagedScheduleState> {
    return scheduleState(
      await this.#bridge.execute("remove-schedule", { scheduleId }),
    );
  }

  async restorePaths(
    paths: readonly WindowsProtectedPath[],
    identityName: string,
  ): Promise<WindowsPathRestorationState> {
    const response = requireRecord(
      await this.#bridge.execute("restore-paths", { identityName, paths }),
      "path restoration",
    );
    if (typeof response.restored !== "boolean") {
      throw new Error("Windows PowerShell did not confirm path restoration.");
    }
    return { restored: response.restored };
  }
}
