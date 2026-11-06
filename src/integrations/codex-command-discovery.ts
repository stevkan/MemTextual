import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";

export interface CodexCommandDiscoveryOptions {
  environment?: NodeJS.ProcessEnv;
  explicitCommand?: string;
  localAppData?: string;
  platform?: NodeJS.Platform;
}

export function discoverCodexDesktopCommands(
  options: CodexCommandDiscoveryOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const localAppData = options.localAppData ?? environment.LOCALAPPDATA;
  if (platform !== "win32" || !localAppData) {
    return [];
  }

  const directory = win32.join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(directory)) {
    return [];
  }

  const candidates = new Set<string>();
  const direct = win32.join(directory, "codex.exe");
  if (existsSync(direct)) {
    candidates.add(direct);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const nested = win32.join(directory, entry.name, "codex.exe");
    if (existsSync(nested)) {
      candidates.add(nested);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

export function resolveCodexCommand(
  options: CodexCommandDiscoveryOptions = {},
): string {
  const explicit = options.explicitCommand?.trim();
  if (options.explicitCommand !== undefined) {
    if (!explicit) {
      throw new Error("Codex command must not be empty.");
    }
    return explicit;
  }

  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  if (platform === "win32") {
    const path = environment.Path ?? environment.PATH ?? "";
    for (const directory of path.split(";")) {
      const trimmed = directory.trim().replace(/^"|"$/gu, "");
      if (trimmed.length === 0) {
        continue;
      }
      const candidate = win32.join(trimmed, "codex.exe");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return selectCodexDesktopCommand(
      discoverCodexDesktopCommands({ ...options, platform }),
    ) ?? "codex";
  }
  return "codex";
}

export function selectCodexDesktopCommand(
  candidates: readonly string[],
): string | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length > 1) {
    throw new Error(
      [
        "Multiple Codex desktop CLI installations were found.",
        ...candidates.map((candidate) => `- ${candidate}`),
        "Specify the intended executable with --codex-command.",
      ].join("\n"),
    );
  }
  return candidates[0];
}
