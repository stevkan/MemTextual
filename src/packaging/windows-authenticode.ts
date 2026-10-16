import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

export const windowsAuthenticodeReportFormatVersion = 1 as const;

export type WindowsCertificateStore = "current-user" | "local-machine";

export interface WindowsAuthenticodeSignRequest {
  artifactPath: string;
  certificateStore: WindowsCertificateStore;
  certificateThumbprint: string;
  timestampUrl: string;
}

export interface WindowsAuthenticodeOperations {
  sign(request: WindowsAuthenticodeSignRequest): Promise<void>;
  verify(artifactPath: string): Promise<void>;
}

export interface WindowsAuthenticodeSigningOptions {
  certificateStore: WindowsCertificateStore;
  certificateThumbprint: string;
  operations: WindowsAuthenticodeOperations;
  signedArtifactPath: string;
  signToolPath: string;
  timestampUrl: string;
  unsignedArtifactPath: string;
}

export interface WindowsAuthenticodeSigningPreview {
  certificateStore: WindowsCertificateStore;
  certificateThumbprint: string;
  confirmation: string;
  operation: "sign-windows-installer";
  signedArtifactPath: string;
  signToolPath: string;
  signToolSha256: string;
  timestampUrl: string;
  unsignedArtifactBytes: number;
  unsignedArtifactPath: string;
  unsignedArtifactSha256: string;
}

export interface WindowsAuthenticodeSigningReport
  extends Omit<WindowsAuthenticodeSigningPreview, "confirmation"> {
  formatVersion: typeof windowsAuthenticodeReportFormatVersion;
  signedArtifactBytes: number;
  signedArtifactSha256: string;
  verified: true;
}

export interface ApplyWindowsAuthenticodeSigningOptions
  extends WindowsAuthenticodeSigningOptions {
  confirmation: string;
}

const supportedExtensions = new Set([
  ".appx",
  ".appxbundle",
  ".exe",
  ".msi",
  ".msix",
  ".msixbundle",
]);

function directFile(path: string, label: string): void {
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

function directDirectory(path: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory.`);
  }
}

async function measureFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: string | Buffer) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      hash.update(buffer);
    });
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return { bytes, sha256: hash.digest("hex") };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function confirmation(value: unknown): string {
  return `SIGN-WINDOWS-INSTALLER-${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, 20)
    .toUpperCase()}`;
}

function normalizedThumbprint(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-F0-9]{40}$/u.test(normalized)) {
    throw new Error("Signing certificate thumbprint must be exactly 40 hexadecimal characters.");
  }
  return normalized;
}

function validatedTimestampUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Timestamp URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("Timestamp URL must be an HTTPS URL without embedded credentials.");
  }
  return parsed.toString();
}

function validatedAbsolutePath(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return resolve(value);
}

export async function previewWindowsAuthenticodeSigning(
  options: WindowsAuthenticodeSigningOptions,
): Promise<WindowsAuthenticodeSigningPreview> {
  const unsignedArtifactPath = validatedAbsolutePath(
    options.unsignedArtifactPath,
    "Unsigned installer artifact path",
  );
  const signedArtifactPath = validatedAbsolutePath(
    options.signedArtifactPath,
    "Signed installer artifact path",
  );
  const signToolPath = validatedAbsolutePath(options.signToolPath, "SignTool path");
  directFile(unsignedArtifactPath, "Unsigned installer artifact");
  directFile(signToolPath, "SignTool executable");
  directDirectory(dirname(signedArtifactPath), "Signed installer output directory");
  if (unsignedArtifactPath.toLowerCase() === signedArtifactPath.toLowerCase()) {
    throw new Error("Unsigned and signed installer artifact paths must be different.");
  }
  if (existsSync(signedArtifactPath)) {
    throw new Error("Signed installer artifact already exists.");
  }
  const sourceExtension = extname(unsignedArtifactPath).toLowerCase();
  if (!supportedExtensions.has(sourceExtension)) {
    throw new Error("Unsigned artifact is not a supported Windows installer format.");
  }
  if (extname(signedArtifactPath).toLowerCase() !== sourceExtension) {
    throw new Error("Unsigned and signed installer artifact extensions must match.");
  }
  if (
    options.certificateStore !== "current-user" &&
    options.certificateStore !== "local-machine"
  ) {
    throw new Error("Certificate store must be current-user or local-machine.");
  }
  const certificateThumbprint = normalizedThumbprint(options.certificateThumbprint);
  const timestampUrl = validatedTimestampUrl(options.timestampUrl);
  const [artifact, tool] = await Promise.all([
    measureFile(unsignedArtifactPath),
    measureFile(signToolPath),
  ]);
  const boundary = {
    certificateStore: options.certificateStore,
    certificateThumbprint,
    operation: "sign-windows-installer" as const,
    signedArtifactPath,
    signToolPath,
    signToolSha256: tool.sha256,
    timestampUrl,
    unsignedArtifactBytes: artifact.bytes,
    unsignedArtifactPath,
    unsignedArtifactSha256: artifact.sha256,
  };
  return { ...boundary, confirmation: confirmation(boundary) };
}

export async function applyWindowsAuthenticodeSigning(
  options: ApplyWindowsAuthenticodeSigningOptions,
): Promise<WindowsAuthenticodeSigningReport> {
  const preview = await previewWindowsAuthenticodeSigning(options);
  if (options.confirmation !== preview.confirmation) {
    throw new Error("Authenticode signing confirmation is missing, incorrect, or stale.");
  }
  let outputCreated = false;
  try {
    copyFileSync(
      preview.unsignedArtifactPath,
      preview.signedArtifactPath,
      constants.COPYFILE_EXCL,
    );
    outputCreated = true;
    await options.operations.sign({
      artifactPath: preview.signedArtifactPath,
      certificateStore: preview.certificateStore,
      certificateThumbprint: preview.certificateThumbprint,
      timestampUrl: preview.timestampUrl,
    });
    directFile(preview.signedArtifactPath, "Signed installer artifact");
    await options.operations.verify(preview.signedArtifactPath);
    const [sourceAfter, signed] = await Promise.all([
      measureFile(preview.unsignedArtifactPath),
      measureFile(preview.signedArtifactPath),
    ]);
    if (
      sourceAfter.bytes !== preview.unsignedArtifactBytes ||
      sourceAfter.sha256 !== preview.unsignedArtifactSha256
    ) {
      throw new Error("Unsigned installer artifact changed during signing.");
    }
    const { confirmation: _confirmation, ...boundary } = preview;
    return {
      ...boundary,
      formatVersion: windowsAuthenticodeReportFormatVersion,
      signedArtifactBytes: signed.bytes,
      signedArtifactSha256: signed.sha256,
      verified: true,
    };
  } catch (error) {
    if (outputCreated && existsSync(preview.signedArtifactPath)) {
      try {
        unlinkSync(preview.signedArtifactPath);
      } catch (cleanupError) {
        const reason = cleanupError instanceof Error ? cleanupError.message : "unknown error";
        throw new Error(
          `Authenticode signing failed and the incomplete output could not be removed: ${reason}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

export interface WindowsSignToolOperationsOptions {
  runner?: WindowsSignToolRunner;
  signToolPath: string;
  timeoutMs?: number;
}

export type WindowsSignToolRunner = (
  executablePath: string,
  arguments_: readonly string[],
  timeoutMs: number,
) => void;

const runWindowsSignTool: WindowsSignToolRunner = (
  executablePath,
  arguments_,
  timeoutMs,
) => {
  const result = spawnSync(executablePath, arguments_, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw new Error(`SignTool could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(
      `SignTool ${arguments_[0]} failed with exit code ${String(result.status)}${
        detail === "" ? "." : `: ${detail}`
      }`,
    );
  }
};

export class WindowsSignToolOperations implements WindowsAuthenticodeOperations {
  readonly #runner: WindowsSignToolRunner;
  readonly #signToolPath: string;
  readonly #timeoutMs: number;

  constructor(options: WindowsSignToolOperationsOptions) {
    this.#runner = options.runner ?? runWindowsSignTool;
    this.#signToolPath = resolve(options.signToolPath);
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  async sign(request: WindowsAuthenticodeSignRequest): Promise<void> {
    const storeArguments = request.certificateStore === "local-machine" ? ["/sm"] : [];
    this.#run([
      "sign",
      "/fd",
      "SHA256",
      "/sha1",
      request.certificateThumbprint,
      ...storeArguments,
      "/tr",
      request.timestampUrl,
      "/td",
      "SHA256",
      "/v",
      request.artifactPath,
    ]);
  }

  async verify(artifactPath: string): Promise<void> {
    this.#run(["verify", "/pa", "/all", "/v", artifactPath]);
  }

  #run(arguments_: readonly string[]): void {
    this.#runner(this.#signToolPath, arguments_, this.#timeoutMs);
  }
}
