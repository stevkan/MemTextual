import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { verifyWindowsContinuityBundle, type WindowsContinuityBundleVerification } from "./windows-continuity-bundle.js";

export const windowsMsiReportFormatVersion = 1 as const;
export const windowsMsiUpgradeCode = "{9B631561-76E8-4DF0-BE45-ED9CE553829D}" as const;
const bundleMetadataFiles = ["bundle-manifest.json", "bundle-manifest.sig", "bundle-signing-certificate.pem"] as const;

export interface WindowsMsiOperations {
  build(sourcePath: string, outputPath: string): Promise<void>;
  validate(outputPath: string): Promise<void>;
  version(): Promise<string>;
}

export interface WindowsMsiBuildOptions {
  bundleDirectory: string;
  manufacturer: string;
  operations: WindowsMsiOperations;
  outputPath: string;
  trustedCertificateFingerprint256: string;
  wixEulaAccepted: true;
  wixExecutablePath: string;
  verifyBundle?: WindowsMsiBundleVerifier;
}

export type WindowsMsiBundleVerifier = (options: {
  bundleDirectory: string;
  trustedCertificateFingerprint256?: string;
}) => Promise<WindowsContinuityBundleVerification>;

export interface WindowsMsiBuildPreview {
  bundleDirectory: string;
  bundleManifestSha256: string;
  confirmation: string;
  fileCount: number;
  manufacturer: string;
  operation: "build-unsigned-windows-msi";
  outputPath: string;
  packageVersion: string;
  scope: "perMachine";
  upgradeCode: typeof windowsMsiUpgradeCode;
  wixExecutablePath: string;
  wixExecutableSha256: string;
  wixVersion: string;
}

export interface WindowsMsiBuildReport extends Omit<WindowsMsiBuildPreview, "confirmation"> {
  formatVersion: typeof windowsMsiReportFormatVersion;
  outputBytes: number;
  outputSha256: string;
  validated: true;
}

function directFile(path: string, label: string): void {
  let stats;
  try { stats = lstatSync(path); } catch { throw new Error(`${label} does not exist.`); }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a direct regular file.`);
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function id(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function hashFile(path: string): { bytes: number; sha256: string } {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function token(value: unknown): string {
  return `BUILD-WINDOWS-MSI-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20).toUpperCase()}`;
}

function validateManufacturer(value: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 100 || /[\u0000-\u001f]/u.test(result)) {
    throw new Error("MSI manufacturer must be a non-empty release-owner name of at most 100 characters.");
  }
  return result;
}

function validateWixVersion(value: string): string {
  const match = value.trim().match(/^(7\.\d+\.\d+)(?:[-+].*)?$/u);
  if (match?.[1] === undefined) throw new Error("Windows MSI creation requires WiX Toolset 7.x.");
  return match[1];
}

export function renderWindowsMsiSource(options: {
  bundleDirectory: string;
  files: readonly string[];
  manufacturer: string;
  packageVersion: string;
}): string {
  const directories = new Map<string, string>();
  for (const path of options.files) {
    const parts = path.split("/").slice(0, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      const relative = parts.slice(0, index).join("/");
      directories.set(relative, id("Dir", relative));
    }
  }
  const children = new Map<string, string[]>();
  for (const path of directories.keys()) {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const list = children.get(parent) ?? [];
    list.push(path);
    children.set(parent, list);
  }
  const filesByDirectory = new Map<string, string[]>();
  for (const path of options.files) {
    const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const list = filesByDirectory.get(directory) ?? [];
    list.push(path);
    filesByDirectory.set(directory, list);
  }
  const componentIds: string[] = [];
  const renderDirectory = (path: string, indent: string): string[] => {
    const lines: string[] = [];
    for (const file of filesByDirectory.get(path) ?? []) {
      const componentId = id("Cmp", file);
      componentIds.push(componentId);
      lines.push(`${indent}<Component Id="${componentId}" Guid="*" Bitness="always64">`);
      lines.push(`${indent}  <File Id="${id("File", file)}" Source="${xml(join(options.bundleDirectory, ...file.split("/")))}" KeyPath="yes" />`);
      lines.push(`${indent}</Component>`);
    }
    for (const child of (children.get(path) ?? []).sort()) {
      const name = child.slice(child.lastIndexOf("/") + 1);
      lines.push(`${indent}<Directory Id="${directories.get(child)!}" Name="${xml(name)}">`);
      lines.push(...renderDirectory(child, `${indent}  `));
      lines.push(`${indent}</Directory>`);
    }
    return lines;
  };
  const directoryLines = renderDirectory("", "        ");
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" RequiredVersion="7.0.0">',
    `  <Package Name="MemTextual Continuity" Manufacturer="${xml(options.manufacturer)}" Version="${xml(options.packageVersion)}" UpgradeCode="${windowsMsiUpgradeCode}" Scope="perMachine" InstallerVersion="500" Compressed="yes">`,
    '    <MajorUpgrade DowngradeErrorMessage="A newer version of MemTextual Continuity is already installed." />',
    '    <MediaTemplate EmbedCab="yes" />',
    '    <StandardDirectory Id="ProgramFiles64Folder">',
    '      <Directory Id="MemTextualFolder" Name="MemTextual">',
    '        <Directory Id="INSTALLFOLDER" Name="Continuity">',
    ...directoryLines,
    '        </Directory>',
    '      </Directory>',
    '    </StandardDirectory>',
    '    <Feature Id="MainFeature" Title="MemTextual Continuity">',
    ...componentIds.sort().map((componentId) => `      <ComponentRef Id="${componentId}" />`),
    '    </Feature>',
    '  </Package>',
    '</Wix>',
    '',
  ].join("\n");
}

export async function previewWindowsMsiBuild(options: WindowsMsiBuildOptions): Promise<WindowsMsiBuildPreview> {
  if (options.wixEulaAccepted !== true) throw new Error("Explicit WiX Toolset EULA acceptance is required.");
  if (!isAbsolute(options.outputPath) || !isAbsolute(options.wixExecutablePath)) throw new Error("MSI output and WiX executable paths must be absolute.");
  const outputPath = resolve(options.outputPath);
  const wixExecutablePath = resolve(options.wixExecutablePath);
  if (!outputPath.toLowerCase().endsWith(".msi")) throw new Error("MSI output path must end in .msi.");
  if (existsSync(outputPath)) throw new Error("MSI output already exists.");
  directFile(wixExecutablePath, "WiX executable");
  const parent = dirname(outputPath);
  let parentStats;
  try { parentStats = lstatSync(parent); } catch { throw new Error("MSI output directory does not exist."); }
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error("MSI output directory must be a direct directory.");
  const manufacturer = validateManufacturer(options.manufacturer);
  const verification = await (options.verifyBundle ?? verifyWindowsContinuityBundle)({ bundleDirectory: options.bundleDirectory, trustedCertificateFingerprint256: options.trustedCertificateFingerprint256 });
  if (!verification.publisherTrusted) throw new Error("Windows bundle publisher is not trusted.");
  const wixVersion = validateWixVersion(await options.operations.version());
  const tool = hashFile(wixExecutablePath);
  const boundary = {
    bundleDirectory: verification.bundleDirectory,
    bundleManifestSha256: verification.manifestSha256,
    fileCount: verification.fileCount + bundleMetadataFiles.length,
    manufacturer,
    operation: "build-unsigned-windows-msi" as const,
    outputPath,
    packageVersion: verification.manifest.packageVersion,
    scope: "perMachine" as const,
    upgradeCode: windowsMsiUpgradeCode,
    wixExecutablePath,
    wixExecutableSha256: tool.sha256,
    wixVersion,
  };
  return { ...boundary, confirmation: token(boundary) };
}

export async function applyWindowsMsiBuild(options: WindowsMsiBuildOptions & { confirmation: string }): Promise<WindowsMsiBuildReport> {
  const preview = await previewWindowsMsiBuild(options);
  if (options.confirmation !== preview.confirmation) throw new Error("MSI build confirmation is missing, incorrect, or stale.");
  const verification = await (options.verifyBundle ?? verifyWindowsContinuityBundle)({ bundleDirectory: preview.bundleDirectory, trustedCertificateFingerprint256: options.trustedCertificateFingerprint256 });
  if (verification.manifestSha256 !== preview.bundleManifestSha256) throw new Error("Windows bundle changed after MSI preview.");
  const workspace = mkdtempSync(join(dirname(preview.outputPath), ".memtextual-msi-"));
  const sourcePath = join(workspace, "Product.wxs");
  const candidatePath = join(workspace, basename(preview.outputPath));
  let finalCreated = false;
  try {
    writeFileSync(sourcePath, renderWindowsMsiSource({ bundleDirectory: preview.bundleDirectory, files: [...verification.manifest.files.map(({ path }) => path), ...bundleMetadataFiles].sort(), manufacturer: preview.manufacturer, packageVersion: preview.packageVersion }), { encoding: "utf8", flag: "wx" });
    await options.operations.build(sourcePath, candidatePath);
    directFile(candidatePath, "Unsigned MSI candidate");
    const header = readFileSync(candidatePath).subarray(0, 8).toString("hex");
    if (header !== "d0cf11e0a1b11ae1") throw new Error("Unsigned MSI output is not a Windows Installer compound file.");
    await options.operations.validate(candidatePath);
    const candidate = hashFile(candidatePath);
    copyFileSync(candidatePath, preview.outputPath, constants.COPYFILE_EXCL);
    finalCreated = true;
    directFile(preview.outputPath, "Unsigned MSI output");
    const measured = hashFile(preview.outputPath);
    if (measured.bytes !== candidate.bytes || measured.sha256 !== candidate.sha256) throw new Error("Published MSI output does not match its validated candidate.");
    const { confirmation: _confirmation, ...boundary } = preview;
    return { ...boundary, formatVersion: windowsMsiReportFormatVersion, outputBytes: measured.bytes, outputSha256: measured.sha256, validated: true };
  } catch (error) {
    if (finalCreated && existsSync(preview.outputPath)) {
      try {
        unlinkSync(preview.outputPath);
      } catch (cleanupError) {
        const reason = cleanupError instanceof Error ? cleanupError.message : "unknown error";
        throw new Error(`MSI creation failed and the incomplete output could not be removed: ${reason}`, { cause: error });
      }
    }
    throw error;
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

export class WindowsWixOperations implements WindowsMsiOperations {
  constructor(readonly executablePath: string, readonly timeoutMs = 180_000) {}
  async version(): Promise<string> { return this.run(["--version"]); }
  async build(sourcePath: string, outputPath: string): Promise<void> { this.run(["build", "-arch", "x64", "-o", outputPath, sourcePath]); }
  async validate(outputPath: string): Promise<void> { this.run(["msi", "validate", outputPath]); }
  private run(args: readonly string[]): string {
    const result = spawnSync(this.executablePath, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: this.timeoutMs, windowsHide: true });
    if (result.error !== undefined) throw new Error(`WiX could not be executed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`WiX ${args[0]} failed with exit code ${String(result.status)}: ${`${result.stderr}\n${result.stdout}`.trim()}`);
    return result.stdout.trim();
  }
}
