#!/usr/bin/env node

import {
  renderContinuityCloudflareTunnelConfiguration,
  writeContinuityCloudflareTunnelConfiguration,
} from "../configuration/cloudflare-tunnel-configuration.js";
import { loadContinuityRemoteConfiguration } from "../configuration/continuity-remote-configuration.js";

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-tunnel create --remote-config PATH --tunnel-id UUID --credentials-file PATH --output PATH",
    "",
    "Creates a new Cloudflare Tunnel YAML file without modifying Cloudflare or starting cloudflared.",
  ].join("\n");
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "create") {
    throw new Error(usage());
  }
  const allowed = new Set([
    "--credentials-file",
    "--output",
    "--remote-config",
    "--tunnel-id",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  const required = (option: string): string => {
    const value = values.get(option)?.trim();
    if (value === undefined || value === "") {
      throw new Error(`create requires ${option}.`);
    }
    return value;
  };
  const content = renderContinuityCloudflareTunnelConfiguration({
    configuration: loadContinuityRemoteConfiguration(
      required("--remote-config"),
    ),
    credentialsFile: required("--credentials-file"),
    tunnelId: required("--tunnel-id"),
  });
  const output = writeContinuityCloudflareTunnelConfiguration(
    required("--output"),
    content,
  );
  process.stdout.write(
    `${JSON.stringify({ created: true, output }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown tunnel error";
  process.stderr.write(`MemTextual Continuity tunnel failed: ${message}\n`);
  process.exitCode = 1;
}
