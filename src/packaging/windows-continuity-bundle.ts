import { spawnSync } from "node:child_process";
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  sign,
  verify,
} from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const windowsContinuityBundleFormatVersion = 1 as const;

export interface WindowsContinuityBundleFile {
  bytes: number;
  path: string;
  sha256: string;
}

export interface WindowsContinuityBundleManifest {
  architecture: "x64";
  createdAt: string;
  files: readonly WindowsContinuityBundleFile[];
  formatVersion: typeof windowsContinuityBundleFormatVersion;
  nodeVersion: string;
  packageName: "memtextual-continuity";
  packageVersion: string;
  platform: "windows";
  signingCertificateFingerprint256: string;
}

export interface CreateWindowsContinuityBundleOptions {
  applicationLicensePath: string;
  createdAt?: Date;
  outputDirectory: string;
  runtimeExecutablePath: string;
  runtimeLicensePath: string;
  signingCertificatePath: string;
  signingPrivateKeyPath: string;
  sourceDirectory: string;
}

export interface WindowsContinuityBundleVerification {
  bundleDirectory: string;
  fileCount: number;
  manifest: WindowsContinuityBundleManifest;
  manifestSha256: string;
  publisherTrusted: boolean;
  signingCertificateFingerprint256: string;
  totalBytes: number;
  verified: true;
}

export interface WindowsContinuityStagePreview
  extends WindowsContinuityBundleVerification {
  confirmation: string;
  operation: "stage";
  targetDirectory: string;
}

export interface WindowsContinuityRemovalPreview
  extends WindowsContinuityBundleVerification {
  confirmation: string;
  operation: "remove";
  preservesExternalData: true;
  targetDirectory: string;
}

interface PackageLockEntry {
  dev?: boolean;
  link?: boolean;
  optional?: boolean;
}

interface PackageLockShape {
  lockfileVersion?: unknown;
  packages?: Record<string, PackageLockEntry>;
}

const manifestFilename = "bundle-manifest.json";
const signatureFilename = "bundle-manifest.sig";
const certificateFilename = "bundle-signing-certificate.pem";
const requiredBundleFiles = new Set([
  "CHANGELOG.md",
  "LICENSE.txt",
  "README.md",
  "dist/src/cli/safeguard.js",
  "dist/src/cli/continuity-acceptance.js",
  "dist/src/cli/continuity-console.js",
  "dist/src/cli/continuity-setup.js",
  "dist/src/cli/continuity-upgrade.js",
  "dist/src/cli/windows-host.js",
  "runtime/LICENSE",
  "runtime/node.exe",
  "scripts/windows-host-executor.ps1",
  "package.json",
  "package-lock.json",
]);

function requireDirectPath(
  path: string,
  kind: "directory" | "file",
  label: string,
): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (
    stats.isSymbolicLink() ||
    (kind === "directory" ? !stats.isDirectory() : !stats.isFile())
  ) {
    throw new Error(`${label} must be a direct ${kind}.`);
  }
}

function directJson(path: string, label: string): unknown {
  requireDirectPath(path, "file", label);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function normalizedRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function safeRelativePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeVersion(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function sha256Buffer(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function measureFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk: string | Buffer) => {
      const bytesChunk = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += bytesChunk.length;
      hash.update(bytesChunk);
    });
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return { bytes, sha256: hash.digest("hex") };
}

function copyDirectFile(source: string, target: string): void {
  requireDirectPath(source, "file", `Bundle source file ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target, constants.COPYFILE_EXCL);
}

function copyDirectTree(source: string, target: string): void {
  requireDirectPath(source, "directory", `Bundle source directory ${source}`);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Bundle source must not contain links: ${sourcePath}.`);
    }
    if (entry.isDirectory()) {
      copyDirectTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyDirectFile(sourcePath, targetPath);
    } else {
      throw new Error(`Bundle source contains an unsupported entry: ${sourcePath}.`);
    }
  }
}

function copyPackageTree(source: string, target: string): void {
  requireDirectPath(source, "directory", `Bundle package directory ${source}`);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Bundle package must not contain links: ${sourcePath}.`);
    }
    if (entry.isDirectory()) copyDirectTree(sourcePath, targetPath);
    else if (entry.isFile()) copyDirectFile(sourcePath, targetPath);
    else throw new Error(`Bundle package contains an unsupported entry: ${sourcePath}.`);
  }
}

function productionPackagePaths(sourceDirectory: string): string[] {
  const lock = directJson(
    join(sourceDirectory, "package-lock.json"),
    "Package lock",
  ) as PackageLockShape;
  if (lock.lockfileVersion !== 3 || lock.packages === undefined) {
    throw new Error("Package lock must use lockfile version 3 with package entries.");
  }
  return Object.entries(lock.packages)
    .filter(
      ([path, entry]) =>
        path.startsWith("node_modules/") &&
        entry.dev !== true &&
        entry.link !== true,
    )
    .map(([path]) => safeRelativePath(path, "Package-lock module path"))
    .sort();
}

function copyProductionModules(sourceDirectory: string, bundleDirectory: string): void {
  const lock = directJson(
    join(sourceDirectory, "package-lock.json"),
    "Package lock",
  ) as PackageLockShape;
  const packages = lock.packages!;
  for (const path of productionPackagePaths(sourceDirectory)) {
    const source = join(sourceDirectory, ...path.split("/"));
    const target = join(bundleDirectory, ...path.split("/"));
    if (!lstatExists(source)) {
      if (packages[path]?.optional === true) continue;
      throw new Error(`Production dependency is missing from node_modules: ${path}.`);
    }
    copyPackageTree(source, target);
  }
}

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function listDirectFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Windows bundle must not contain links: ${path}.`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(normalizedRelativePath(relative(root, path)));
      else throw new Error(`Windows bundle contains an unsupported entry: ${path}.`);
    }
  };
  visit(root);
  return files.sort();
}

async function measureBundleFiles(
  bundleDirectory: string,
  excluded: ReadonlySet<string>,
): Promise<WindowsContinuityBundleFile[]> {
  const result: WindowsContinuityBundleFile[] = [];
  for (const path of listDirectFiles(bundleDirectory)) {
    if (excluded.has(path)) continue;
    const measured = await measureFile(join(bundleDirectory, ...path.split("/")));
    result.push({ ...measured, path });
  }
  return result;
}

function certificatePem(value: string): string {
  const block = value.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
  )?.[0];
  if (block === undefined) {
    throw new Error("Bundle signing certificate PEM is missing a certificate.");
  }
  return `${block}\n`;
}

function certificateFingerprint(certificate: X509Certificate): string {
  return certificate.fingerprint256.replaceAll(":", "").toLowerCase();
}

function validateRuntime(path: string, expectedVersion: string): void {
  requireDirectPath(path, "file", "Windows Node runtime");
  const result = spawnSync(
    path,
    ["-p", "JSON.stringify({arch:process.arch,platform:process.platform,version:process.versions.node})"],
    {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Windows Node runtime could not be inspected.");
  }
  let identity: unknown;
  try {
    identity = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("Windows Node runtime returned invalid identity data.");
  }
  if (
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity) ||
    (identity as Record<string, unknown>).arch !== "x64" ||
    (identity as Record<string, unknown>).platform !== "win32" ||
    (identity as Record<string, unknown>).version !== expectedVersion
  ) {
    throw new Error(
      `Windows Node runtime must be Windows x64 version ${expectedVersion}.`,
    );
  }
}

function parseManifest(value: unknown): WindowsContinuityBundleManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Windows bundle manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = new Set([
    "architecture",
    "createdAt",
    "files",
    "formatVersion",
    "nodeVersion",
    "packageName",
    "packageVersion",
    "platform",
    "signingCertificateFingerprint256",
  ]);
  const unexpected = Object.keys(record).filter((key) => !keys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Windows bundle manifest has unsupported properties: ${unexpected.join(", ")}.`);
  }
  if (
    record.formatVersion !== windowsContinuityBundleFormatVersion ||
    record.packageName !== "memtextual-continuity" ||
    record.platform !== "windows" ||
    record.architecture !== "x64" ||
    typeof record.createdAt !== "string" ||
    typeof record.nodeVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(record.nodeVersion) ||
    !/^[a-f0-9]{64}$/u.test(String(record.signingCertificateFingerprint256)) ||
    !Array.isArray(record.files)
  ) {
    throw new Error("Windows bundle manifest identity is invalid.");
  }
  try {
    if (new Date(record.createdAt).toISOString() !== record.createdAt) {
      throw new Error();
    }
  } catch {
    throw new Error("Windows bundle manifest identity is invalid.");
  }
  const packageVersion = safeVersion(record.packageVersion, "Windows bundle packageVersion");
  const files = record.files.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Windows bundle manifest file entry is invalid.");
    }
    const file = item as Record<string, unknown>;
    if (
      Object.keys(file).sort().join(",") !== "bytes,path,sha256" ||
      !Number.isSafeInteger(file.bytes) ||
      Number(file.bytes) < 0 ||
      !/^[a-f0-9]{64}$/u.test(String(file.sha256))
    ) {
      throw new Error("Windows bundle manifest file entry is invalid.");
    }
    return {
      bytes: Number(file.bytes),
      path: safeRelativePath(file.path, "Windows bundle manifest file path"),
      sha256: String(file.sha256),
    };
  });
  if (
    files.length === 0 ||
    new Set(files.map(({ path }) => path)).size !== files.length ||
    files.some((file, index) => index > 0 && files[index - 1]!.path >= file.path) ||
    [...requiredBundleFiles].some((required) => !files.some(({ path }) => path === required))
  ) {
    throw new Error("Windows bundle manifest file inventory is invalid.");
  }
  return {
    architecture: "x64",
    createdAt: record.createdAt,
    files,
    formatVersion: windowsContinuityBundleFormatVersion,
    nodeVersion: record.nodeVersion,
    packageName: "memtextual-continuity",
    packageVersion,
    platform: "windows",
    signingCertificateFingerprint256: String(
      record.signingCertificateFingerprint256,
    ),
  };
}

export async function createWindowsContinuityBundle(
  options: CreateWindowsContinuityBundleOptions,
): Promise<WindowsContinuityBundleVerification> {
  const sourceDirectory = resolve(options.sourceDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  requireDirectPath(sourceDirectory, "directory", "Bundle source directory");
  requireDirectPath(outputDirectory, "directory", "Bundle output directory");
  if (isWithin(sourceDirectory, outputDirectory) || isWithin(outputDirectory, sourceDirectory)) {
    throw new Error("Bundle source and output directories must not overlap.");
  }
  const packageJson = directJson(
    join(sourceDirectory, "package.json"),
    "Package manifest",
  ) as Record<string, unknown>;
  const packageVersion = safeVersion(packageJson.version, "Package version");
  const engines = packageJson.engines;
  if (engines === null || typeof engines !== "object" || Array.isArray(engines)) {
    throw new Error("Package manifest Node engine is invalid.");
  }
  const nodeVersion = safeVersion(
    (engines as Record<string, unknown>).node,
    "Package manifest Node engine",
  );
  const runtimeExecutablePath = resolve(options.runtimeExecutablePath);
  validateRuntime(runtimeExecutablePath, nodeVersion);
  const createdAt = options.createdAt ?? new Date();
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("Bundle creation time is invalid.");
  }
  const createdAtText = createdAt.toISOString();
  const certificateSource = resolve(options.signingCertificatePath);
  const privateKeySource = resolve(options.signingPrivateKeyPath);
  requireDirectPath(certificateSource, "file", "Bundle signing certificate");
  requireDirectPath(privateKeySource, "file", "Bundle signing private key");
  const publicCertificatePem = certificatePem(readFileSync(certificateSource, "utf8"));
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(publicCertificatePem);
  } catch {
    throw new Error("Bundle signing certificate is invalid.");
  }
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (createdAt < validFrom || createdAt >= validTo) {
    throw new Error("Bundle signing certificate is not valid at the creation time.");
  }
  const fingerprint = certificateFingerprint(certificate);
  let privateKey;
  try {
    privateKey = createPrivateKey(readFileSync(privateKeySource, "utf8"));
  } catch {
    throw new Error("Bundle signing private key is invalid or encrypted.");
  }
  const bundleName = `memtextual-continuity-windows-x64-${packageVersion}`;
  const finalDirectory = join(outputDirectory, bundleName);
  if (lstatExists(finalDirectory)) {
    throw new Error(`Windows bundle already exists: ${bundleName}.`);
  }
  const temporaryRoot = mkdtempSync(join(outputDirectory, ".memtextual-bundle-"));
  const bundleDirectory = join(temporaryRoot, bundleName);
  let finalCreated = false;
  mkdirSync(bundleDirectory);
  try {
    copyDirectTree(join(sourceDirectory, "dist", "src"), join(bundleDirectory, "dist", "src"));
    copyDirectTree(join(sourceDirectory, "migrations"), join(bundleDirectory, "migrations"));
    copyDirectFile(
      join(sourceDirectory, "scripts", "windows-host-executor.ps1"),
      join(bundleDirectory, "scripts", "windows-host-executor.ps1"),
    );
    copyDirectFile(join(sourceDirectory, "package.json"), join(bundleDirectory, "package.json"));
    copyDirectFile(
      join(sourceDirectory, "package-lock.json"),
      join(bundleDirectory, "package-lock.json"),
    );
    copyDirectFile(join(sourceDirectory, "README.md"), join(bundleDirectory, "README.md"));
    copyDirectFile(
      join(sourceDirectory, "CHANGELOG.md"),
      join(bundleDirectory, "CHANGELOG.md"),
    );
    copyDirectFile(
      resolve(options.applicationLicensePath),
      join(bundleDirectory, "LICENSE.txt"),
    );
    copyProductionModules(sourceDirectory, bundleDirectory);
    copyDirectFile(
      runtimeExecutablePath,
      join(bundleDirectory, "runtime", "node.exe"),
    );
    copyDirectFile(
      resolve(options.runtimeLicensePath),
      join(bundleDirectory, "runtime", "LICENSE"),
    );
    const files = await measureBundleFiles(
      bundleDirectory,
      new Set([manifestFilename, signatureFilename, certificateFilename]),
    );
    const manifest: WindowsContinuityBundleManifest = {
      architecture: "x64",
      createdAt: createdAtText,
      files,
      formatVersion: windowsContinuityBundleFormatVersion,
      nodeVersion,
      packageName: "memtextual-continuity",
      packageVersion,
      platform: "windows",
      signingCertificateFingerprint256: fingerprint,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const signature = sign("sha256", manifestBytes, privateKey);
    if (!verify("sha256", manifestBytes, certificate.publicKey, signature)) {
      throw new Error("Bundle signing key does not match the signing certificate.");
    }
    writeFileSync(join(bundleDirectory, manifestFilename), manifestBytes, { flag: "wx" });
    writeFileSync(
      join(bundleDirectory, signatureFilename),
      `${signature.toString("base64")}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    writeFileSync(
      join(bundleDirectory, certificateFilename),
      publicCertificatePem,
      { encoding: "utf8", flag: "wx" },
    );
    const verified = await verifyWindowsContinuityBundle({
      bundleDirectory,
      trustedCertificateFingerprint256: fingerprint,
    });
    mkdirSync(finalDirectory);
    finalCreated = true;
    copyDirectTree(bundleDirectory, finalDirectory);
    const finalVerification = await verifyWindowsContinuityBundle({
      bundleDirectory: finalDirectory,
      trustedCertificateFingerprint256: fingerprint,
    });
    if (
      finalVerification.manifestSha256 !== verified.manifestSha256 ||
      finalVerification.fileCount !== verified.fileCount ||
      finalVerification.totalBytes !== verified.totalBytes
    ) {
      throw new Error("Published Windows bundle does not match verified staging.");
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
    return finalVerification;
  } catch (error) {
    if (finalCreated) {
      rmSync(finalDirectory, { force: true, recursive: true });
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
}

export async function verifyWindowsContinuityBundle(options: {
  bundleDirectory: string;
  trustedCertificateFingerprint256?: string;
}): Promise<WindowsContinuityBundleVerification> {
  const bundleDirectory = resolve(options.bundleDirectory);
  requireDirectPath(bundleDirectory, "directory", "Windows bundle directory");
  const manifestPath = join(bundleDirectory, manifestFilename);
  const signaturePath = join(bundleDirectory, signatureFilename);
  const certificatePath = join(bundleDirectory, certificateFilename);
  requireDirectPath(manifestPath, "file", "Windows bundle manifest");
  requireDirectPath(signaturePath, "file", "Windows bundle signature");
  requireDirectPath(certificatePath, "file", "Windows bundle signing certificate");
  const manifestBytes = readFileSync(manifestPath);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Windows bundle manifest is not valid JSON.");
  }
  const manifest = parseManifest(manifestValue);
  const publicCertificatePem = certificatePem(readFileSync(certificatePath, "utf8"));
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(publicCertificatePem);
  } catch {
    throw new Error("Windows bundle signing certificate is invalid.");
  }
  const fingerprint = certificateFingerprint(certificate);
  if (fingerprint !== manifest.signingCertificateFingerprint256) {
    throw new Error("Windows bundle certificate does not match its manifest.");
  }
  const signedAt = new Date(manifest.createdAt);
  if (
    signedAt < new Date(certificate.validFrom) ||
    signedAt >= new Date(certificate.validTo)
  ) {
    throw new Error("Windows bundle certificate was not valid at its signed creation time.");
  }
  const signatureText = readFileSync(signaturePath, "utf8").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(signatureText)) {
    throw new Error("Windows bundle signature is not canonical base64.");
  }
  const signature = Buffer.from(signatureText, "base64");
  if (
    signature.length === 0 ||
    signature.toString("base64") !== signatureText ||
    !verify("sha256", manifestBytes, certificate.publicKey, signature)
  ) {
    throw new Error("Windows bundle signature verification failed.");
  }
  const actualFiles = listDirectFiles(bundleDirectory);
  const expectedFiles = [
    ...manifest.files.map(({ path }) => path),
    certificateFilename,
    manifestFilename,
    signatureFilename,
  ].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Windows bundle contains missing or unexpected files.");
  }
  let totalBytes = 0;
  for (const expected of manifest.files) {
    const path = join(bundleDirectory, ...expected.path.split("/"));
    const measured = await measureFile(path);
    if (measured.bytes !== expected.bytes || measured.sha256 !== expected.sha256) {
      throw new Error(`Windows bundle file does not match its manifest: ${expected.path}.`);
    }
    totalBytes += measured.bytes;
  }
  const trusted = options.trustedCertificateFingerprint256?.toLowerCase();
  if (trusted !== undefined && !/^[a-f0-9]{64}$/u.test(trusted)) {
    throw new Error("Trusted signing-certificate fingerprint must be 64 hexadecimal characters.");
  }
  return {
    bundleDirectory,
    fileCount: manifest.files.length,
    manifest,
    manifestSha256: sha256Buffer(manifestBytes),
    publisherTrusted: trusted === fingerprint,
    signingCertificateFingerprint256: fingerprint,
    totalBytes,
    verified: true,
  };
}

function stageConfirmation(value: unknown): string {
  return `STAGE-WINDOWS-BUNDLE-${sha256Buffer(JSON.stringify(value))
    .slice(0, 20)
    .toUpperCase()}`;
}

function removalConfirmation(value: unknown): string {
  return `REMOVE-WINDOWS-BUNDLE-${sha256Buffer(JSON.stringify(value))
    .slice(0, 20)
    .toUpperCase()}`;
}

export async function previewWindowsContinuityBundleStage(options: {
  bundleDirectory: string;
  targetDirectory: string;
  trustedCertificateFingerprint256: string;
}): Promise<WindowsContinuityStagePreview> {
  if (!isAbsolute(options.targetDirectory)) {
    throw new Error("Windows bundle target directory must be absolute.");
  }
  const targetDirectory = resolve(options.targetDirectory);
  const verification = await verifyWindowsContinuityBundle({
    bundleDirectory: options.bundleDirectory,
    trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
  });
  if (!verification.publisherTrusted) {
    throw new Error("Windows bundle signing certificate is not trusted by the supplied fingerprint.");
  }
  if (
    isWithin(verification.bundleDirectory, targetDirectory) ||
    isWithin(targetDirectory, verification.bundleDirectory)
  ) {
    throw new Error("Windows bundle source and staging target must not overlap.");
  }
  if (lstatExists(targetDirectory)) {
    throw new Error("Windows bundle staging target already exists.");
  }
  requireDirectPath(
    dirname(targetDirectory),
    "directory",
    "Windows bundle staging target parent",
  );
  const previewWithoutConfirmation = {
    ...verification,
    operation: "stage" as const,
    targetDirectory,
  };
  return {
    ...previewWithoutConfirmation,
    confirmation: stageConfirmation(previewWithoutConfirmation),
  };
}

export async function applyWindowsContinuityBundleStage(options: {
  bundleDirectory: string;
  confirmation: string;
  targetDirectory: string;
  trustedCertificateFingerprint256: string;
}): Promise<WindowsContinuityStagePreview> {
  const preview = await previewWindowsContinuityBundleStage(options);
  if (options.confirmation !== preview.confirmation) {
    throw new Error(
      "Windows bundle staging confirmation is missing, incorrect, or stale.",
    );
  }
  mkdirSync(preview.targetDirectory);
  try {
    copyDirectTree(preview.bundleDirectory, preview.targetDirectory);
    const staged = await verifyWindowsContinuityBundle({
      bundleDirectory: preview.targetDirectory,
      trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
    });
    if (
      staged.manifestSha256 !== preview.manifestSha256 ||
      staged.fileCount !== preview.fileCount ||
      staged.totalBytes !== preview.totalBytes
    ) {
      throw new Error("Staged Windows bundle does not match the confirmed source.");
    }
    return { ...preview, bundleDirectory: preview.targetDirectory };
  } catch (error) {
    rmSync(preview.targetDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function previewWindowsContinuityBundleRemoval(options: {
  bundleDirectory: string;
  trustedCertificateFingerprint256: string;
}): Promise<WindowsContinuityRemovalPreview> {
  const verification = await verifyWindowsContinuityBundle(options);
  if (!verification.publisherTrusted) {
    throw new Error(
      "Windows bundle signing certificate is not trusted by the supplied fingerprint.",
    );
  }
  const previewWithoutConfirmation = {
    ...verification,
    operation: "remove" as const,
    preservesExternalData: true as const,
    targetDirectory: verification.bundleDirectory,
  };
  return {
    ...previewWithoutConfirmation,
    confirmation: removalConfirmation(previewWithoutConfirmation),
  };
}

export async function applyWindowsContinuityBundleRemoval(options: {
  bundleDirectory: string;
  confirmation: string;
  trustedCertificateFingerprint256: string;
}): Promise<WindowsContinuityRemovalPreview> {
  const preview = await previewWindowsContinuityBundleRemoval(options);
  if (options.confirmation !== preview.confirmation) {
    throw new Error(
      "Windows bundle removal confirmation is missing, incorrect, or stale.",
    );
  }
  const signedFiles = preview.manifest.files.map(({ path }) => path);
  const metadataFiles = [certificateFilename, signatureFilename, manifestFilename];
  const removalFiles = [...signedFiles, ...metadataFiles];
  for (const relativePath of removalFiles) {
    const path = join(preview.targetDirectory, ...relativePath.split("/"));
    requireDirectPath(path, "file", "Windows bundle removal file");
    unlinkSync(path);
  }
  const directories = new Set<string>();
  for (const file of signedFiles) {
    let directory = dirname(file);
    while (directory !== ".") {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  for (const relativePath of [...directories].sort(
    (left, right) => right.length - left.length,
  )) {
    rmdirSync(join(preview.targetDirectory, ...relativePath.split("/")), {
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  rmdirSync(preview.targetDirectory, { maxRetries: 5, retryDelay: 100 });
  if (existsSync(preview.targetDirectory)) {
    throw new Error("Windows bundle removal did not remove the complete application directory.");
  }
  return preview;
}
