import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, win32 } from "node:path";
import * as z from "zod/v4";
import type { ContinuityRemoteConfiguration } from "./continuity-remote-configuration.js";

const tunnelIdSchema = z.uuid();

function credentialsPath(value: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    !win32.isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(
      "Cloudflare tunnel credentials file must be an absolute Windows path.",
    );
  }
  return win32.resolve(value);
}

export function renderContinuityCloudflareTunnelConfiguration(input: {
  configuration: ContinuityRemoteConfiguration;
  credentialsFile: string;
  tunnelId: string;
}): string {
  const tunnelId = tunnelIdSchema.parse(input.tunnelId);
  const credentialsFile = credentialsPath(input.credentialsFile);
  const publicOrigin = new URL(input.configuration.publicOrigin);
  if (publicOrigin.port !== "") {
    throw new Error(
      "Cloudflare tunnel public origin must use the standard HTTPS port.",
    );
  }
  const localService = `http://127.0.0.1:${input.configuration.port}`;
  return [
    `tunnel: ${JSON.stringify(tunnelId)}`,
    `credentials-file: ${JSON.stringify(credentialsFile)}`,
    "ingress:",
    `  - hostname: ${JSON.stringify(publicOrigin.hostname)}`,
    `    service: ${JSON.stringify(localService)}`,
    "  - service: http_status:404",
    "",
  ].join("\n");
}

export function writeContinuityCloudflareTunnelConfiguration(
  outputPath: string,
  content: string,
): string {
  if (
    outputPath.length === 0 ||
    outputPath !== outputPath.trim() ||
    !win32.isAbsolute(outputPath)
  ) {
    throw new Error("Cloudflare tunnel output must be an absolute Windows path.");
  }
  const path = win32.resolve(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
  return path;
}
