import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type TransformCallback } from "node:stream";
import { catalogDatabaseSnapshots } from "./backup-retention.js";
import {
  databaseSafeguardIdentity,
  verifyDatabaseAgainstManifest,
  type DatabaseSafeguardManifest,
} from "./database-safeguard.js";

export const encryptedReplicationManifestFormatVersion = 1 as const;
export const encryptedReplicationVerificationFormatVersion = 1 as const;

type ReplicatedLogicalFile =
  | "database"
  | "durable-data-export"
  | "safeguard-manifest";

export interface EncryptedReplicationFile {
  authTagBase64: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  encryptedFile: string;
  ivBase64: string;
  logicalName: ReplicatedLogicalFile;
  plaintextBytes: number;
  plaintextSha256: string;
}

export interface EncryptedReplicationManifest {
  algorithm: "aes-256-gcm";
  createdAt: string;
  files: EncryptedReplicationFile[];
  formatVersion: typeof encryptedReplicationManifestFormatVersion;
  kdf: "hkdf-sha256";
  keyId: string;
  packageId: string;
  packageSaltBase64: string;
  snapshotCreatedAt: string;
  snapshotDirectory: string;
  sourceDatabase: string;
  sourceDatabaseIdentity: string;
}

export interface EncryptedReplicationVerification {
  checkedTables: number;
  fileCount: number;
  formatVersion: typeof encryptedReplicationVerificationFormatVersion;
  manifestSha256: string;
  packageId: string;
  passed: true;
  reportPath: string;
  verifiedAt: string;
}

export interface CreateEncryptedReplicationOptions {
  databasePath: string;
  destinationDirectory: string;
  keyId: string;
  masterKey: Uint8Array;
  now?: Date;
  snapshotDirectory: string;
  sourceBackupDirectory: string;
}

export interface CreateEncryptedReplicationResult {
  manifest: EncryptedReplicationManifest;
  manifestPath: string;
  packageDirectory: string;
  verification: EncryptedReplicationVerification;
}

export interface VerifyEncryptedReplicationOptions {
  masterKey: Uint8Array;
  now?: Date;
  packageDirectory: string;
}

interface MeasuredDigest {
  bytes: number;
  sha256: string;
}

class MeasuringTransform extends Transform {
  #bytes = 0;
  readonly #hash = createHash("sha256");

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.#bytes += value.length;
    this.#hash.update(value);
    callback(null, value);
  }

  digest(): MeasuredDigest {
    return { bytes: this.#bytes, sha256: this.#hash.digest("hex") };
  }
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid date.`);
  }
  return value;
}

function masterKey(value: Uint8Array): Buffer {
  const key = Buffer.from(value);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error("Encrypted replication masterKey must be exactly 32 bytes.");
  }
  return key;
}

function keyIdentifier(value: string): string {
  const keyId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId)) {
    throw new Error(
      "Encrypted replication keyId must use 1-64 letters, numbers, periods, underscores, or hyphens.",
    );
  }
  return keyId;
}

function directName(value: string, label: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    basename(name) !== name ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(`${label} must be a direct directory name.`);
  }
  return name;
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

function requireDirectDirectory(path: string, label: string): void {
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

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

function aad(manifest: {
  createdAt: string;
  keyId: string;
  packageId: string;
  snapshotDirectory: string;
  sourceDatabaseIdentity: string;
}, logicalName: ReplicatedLogicalFile): Buffer {
  return Buffer.from(
    JSON.stringify({
      createdAt: manifest.createdAt,
      formatVersion: encryptedReplicationManifestFormatVersion,
      keyId: manifest.keyId,
      logicalName,
      packageId: manifest.packageId,
      snapshotDirectory: manifest.snapshotDirectory,
      sourceDatabaseIdentity: manifest.sourceDatabaseIdentity,
    }),
    "utf8",
  );
}

function deriveFileKey(
  key: Buffer,
  salt: Buffer,
  packageId: string,
  logicalName: ReplicatedLogicalFile,
): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      key,
      salt,
      Buffer.from(`memtextual-offsite:${packageId}:${logicalName}`, "utf8"),
      32,
    ),
  );
}

async function encryptFile(input: {
  destinationPath: string;
  key: Buffer;
  logicalName: ReplicatedLogicalFile;
  manifestContext: Parameters<typeof aad>[0];
  salt: Buffer;
  sourcePath: string;
}): Promise<EncryptedReplicationFile> {
  const iv = randomBytes(12);
  const fileKey = deriveFileKey(
    input.key,
    input.salt,
    input.manifestContext.packageId,
    input.logicalName,
  );
  try {
    const cipher = createCipheriv("aes-256-gcm", fileKey, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(aad(input.manifestContext, input.logicalName));
    const plaintext = new MeasuringTransform();
    const ciphertext = new MeasuringTransform();
    await pipeline(
      createReadStream(input.sourcePath),
      plaintext,
      cipher,
      ciphertext,
      createWriteStream(input.destinationPath, { flags: "wx" }),
    );
    const plain = plaintext.digest();
    const encrypted = ciphertext.digest();
    return {
      authTagBase64: cipher.getAuthTag().toString("base64"),
      ciphertextBytes: encrypted.bytes,
      ciphertextSha256: encrypted.sha256,
      encryptedFile: basename(input.destinationPath),
      ivBase64: iv.toString("base64"),
      logicalName: input.logicalName,
      plaintextBytes: plain.bytes,
      plaintextSha256: plain.sha256,
    };
  } finally {
    fileKey.fill(0);
  }
}

function strictBase64(value: string, bytes: number, label: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== bytes || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new Error(`${label} must encode exactly ${bytes} bytes.`);
  }
  return decoded;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function parseManifest(path: string): EncryptedReplicationManifest {
  requireDirectFile(path, "Encrypted replication manifest");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Encrypted replication manifest is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Encrypted replication manifest must be an object.");
  }
  const manifest = value as Partial<EncryptedReplicationManifest>;
  if (
    manifest.formatVersion !== encryptedReplicationManifestFormatVersion ||
    manifest.algorithm !== "aes-256-gcm" ||
    manifest.kdf !== "hkdf-sha256" ||
    typeof manifest.createdAt !== "string" ||
    Number.isNaN(Date.parse(manifest.createdAt)) ||
    typeof manifest.packageId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(manifest.packageId) ||
    typeof manifest.snapshotCreatedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.snapshotCreatedAt)) ||
    typeof manifest.sourceDatabase !== "string" ||
    manifest.sourceDatabase.length === 0 ||
    typeof manifest.sourceDatabaseIdentity !== "string" ||
    !/^[a-f0-9]{64}$/u.test(manifest.sourceDatabaseIdentity) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Encrypted replication manifest is invalid.");
  }
  const keyId = keyIdentifier(manifest.keyId ?? "");
  const snapshotDirectory = directName(
    manifest.snapshotDirectory ?? "",
    "Manifest snapshotDirectory",
  );
  strictBase64(manifest.packageSaltBase64 ?? "", 32, "Manifest package salt").fill(
    0,
  );
  const expectedNames = new Set<ReplicatedLogicalFile>([
    "database",
    "durable-data-export",
    "safeguard-manifest",
  ]);
  const encryptedNames = new Set<string>();
  const files = manifest.files.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`Encrypted replication file ${index} is invalid.`);
    }
    const file = candidate as Partial<EncryptedReplicationFile>;
    if (!expectedNames.has(file.logicalName as ReplicatedLogicalFile)) {
      throw new Error(`Encrypted replication file ${index} has an invalid role.`);
    }
    const logicalName = file.logicalName as ReplicatedLogicalFile;
    if (!expectedNames.delete(logicalName)) {
      throw new Error(`Encrypted replication file role is duplicated: ${logicalName}.`);
    }
    const encryptedFile = directName(
      file.encryptedFile ?? "",
      `Encrypted replication file ${index}`,
    );
    if (!encryptedFile.endsWith(".enc")) {
      throw new Error(`Encrypted replication file ${index} must end in .enc.`);
    }
    if (encryptedNames.has(encryptedFile)) {
      throw new Error(`Encrypted replication file is duplicated: ${encryptedFile}.`);
    }
    encryptedNames.add(encryptedFile);
    strictBase64(file.ivBase64 ?? "", 12, `File ${logicalName} IV`).fill(0);
    strictBase64(file.authTagBase64 ?? "", 16, `File ${logicalName} tag`).fill(0);
    return {
      authTagBase64: file.authTagBase64 ?? "",
      ciphertextBytes: safeInteger(
        file.ciphertextBytes,
        `File ${logicalName} ciphertextBytes`,
      ),
      ciphertextSha256: sha256(
        file.ciphertextSha256,
        `File ${logicalName} ciphertextSha256`,
      ),
      encryptedFile,
      ivBase64: file.ivBase64 ?? "",
      logicalName,
      plaintextBytes: safeInteger(
        file.plaintextBytes,
        `File ${logicalName} plaintextBytes`,
      ),
      plaintextSha256: sha256(
        file.plaintextSha256,
        `File ${logicalName} plaintextSha256`,
      ),
    };
  });
  if (expectedNames.size !== 0 || files.length !== 3) {
    throw new Error("Encrypted replication manifest must contain all three files.");
  }
  return {
    algorithm: "aes-256-gcm",
    createdAt: manifest.createdAt,
    files,
    formatVersion: encryptedReplicationManifestFormatVersion,
    kdf: "hkdf-sha256",
    keyId,
    packageId: manifest.packageId,
    packageSaltBase64: manifest.packageSaltBase64 ?? "",
    snapshotCreatedAt: manifest.snapshotCreatedAt,
    snapshotDirectory,
    sourceDatabase: manifest.sourceDatabase,
    sourceDatabaseIdentity: manifest.sourceDatabaseIdentity,
  };
}

async function decryptFile(input: {
  destinationPath: string;
  file: EncryptedReplicationFile;
  key: Buffer;
  manifest: EncryptedReplicationManifest;
  packageDirectory: string;
  salt: Buffer;
}): Promise<void> {
  const encryptedPath = join(input.packageDirectory, input.file.encryptedFile);
  requireDirectFile(encryptedPath, `Encrypted file ${input.file.encryptedFile}`);
  const fileKey = deriveFileKey(
    input.key,
    input.salt,
    input.manifest.packageId,
    input.file.logicalName,
  );
  const iv = strictBase64(input.file.ivBase64, 12, "Encrypted file IV");
  const tag = strictBase64(input.file.authTagBase64, 16, "Encrypted file tag");
  try {
    const decipher = createDecipheriv("aes-256-gcm", fileKey, iv, {
      authTagLength: 16,
    });
    decipher.setAAD(aad(input.manifest, input.file.logicalName));
    decipher.setAuthTag(tag);
    const ciphertext = new MeasuringTransform();
    const plaintext = new MeasuringTransform();
    await pipeline(
      createReadStream(encryptedPath),
      ciphertext,
      decipher,
      plaintext,
      createWriteStream(input.destinationPath, { flags: "wx" }),
    );
    const encrypted = ciphertext.digest();
    const plain = plaintext.digest();
    if (
      encrypted.bytes !== input.file.ciphertextBytes ||
      encrypted.sha256 !== input.file.ciphertextSha256
    ) {
      throw new Error(`Ciphertext verification failed for ${input.file.logicalName}.`);
    }
    if (
      plain.bytes !== input.file.plaintextBytes ||
      plain.sha256 !== input.file.plaintextSha256
    ) {
      throw new Error(`Plaintext verification failed for ${input.file.logicalName}.`);
    }
  } finally {
    fileKey.fill(0);
    iv.fill(0);
    tag.fill(0);
  }
}

export async function verifyEncryptedReplication(
  options: VerifyEncryptedReplicationOptions,
): Promise<EncryptedReplicationVerification> {
  const packageDirectory = resolve(options.packageDirectory);
  requireDirectDirectory(packageDirectory, "Encrypted replication package");
  const manifestPath = join(packageDirectory, "replication-manifest.json");
  const manifest = parseManifest(manifestPath);
  const key = masterKey(options.masterKey);
  const salt = strictBase64(
    manifest.packageSaltBase64,
    32,
    "Manifest package salt",
  );
  let workspace: string | null = null;
  try {
    workspace = mkdtempSync(join(tmpdir(), "memtextual-offsite-verify-"));
    const destinations: Record<ReplicatedLogicalFile, string> = {
      database: join(workspace, "memtextual.db"),
      "durable-data-export": join(workspace, "durable-data-export.json"),
      "safeguard-manifest": join(workspace, "manifest.json"),
    };
    for (const file of manifest.files) {
      await decryptFile({
        destinationPath: destinations[file.logicalName],
        file,
        key,
        manifest,
        packageDirectory,
        salt,
      });
    }
    const safeguardManifest = JSON.parse(
      readFileSync(destinations["safeguard-manifest"], "utf8"),
    ) as DatabaseSafeguardManifest;
    if (
      safeguardManifest.sourceDatabase !== manifest.sourceDatabase ||
      safeguardManifest.sourceDatabaseIdentity !== manifest.sourceDatabaseIdentity ||
      safeguardManifest.createdAt !== manifest.snapshotCreatedAt ||
      safeguardManifest.backupSha256 !== (await hashFile(destinations.database))
    ) {
      throw new Error(
        "Decrypted safeguard manifest does not match the replication manifest.",
      );
    }
    const verification = verifyDatabaseAgainstManifest({
      databasePath: destinations.database,
      manifestPath: destinations["safeguard-manifest"],
    });
    if (!verification.passed) {
      throw new Error(
        `Decrypted database verification failed: ${verification.problems.join("; ")}`,
      );
    }
    const verifiedAt = validDate(
      options.now ?? new Date(),
      "Encrypted replication verification now",
    ).toISOString();
    const reportPath = join(
      packageDirectory,
      `verification-${timestampForFilename(new Date(verifiedAt))}-${randomUUID()}.json`,
    );
    const report: EncryptedReplicationVerification = {
      checkedTables: verification.checkedTables,
      fileCount: manifest.files.length,
      formatVersion: encryptedReplicationVerificationFormatVersion,
      manifestSha256: await hashFile(manifestPath),
      packageId: manifest.packageId,
      passed: true,
      reportPath,
      verifiedAt,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return report;
  } finally {
    key.fill(0);
    salt.fill(0);
    if (workspace !== null) {
      rmSync(workspace, { force: true, recursive: true });
    }
  }
}

export async function createEncryptedReplication(
  options: CreateEncryptedReplicationOptions,
): Promise<CreateEncryptedReplicationResult> {
  const databasePath = resolve(options.databasePath);
  const databaseDirectory = dirname(databasePath);
  const sourceBackupDirectory = resolve(options.sourceBackupDirectory);
  const destinationDirectory = resolve(options.destinationDirectory);
  if (
    isWithin(sourceBackupDirectory, destinationDirectory) ||
    isWithin(destinationDirectory, sourceBackupDirectory)
  ) {
    throw new Error(
      "Encrypted replication destination must not overlap the local backup destination.",
    );
  }
  if (
    isWithin(databaseDirectory, destinationDirectory) ||
    isWithin(destinationDirectory, databasePath)
  ) {
    throw new Error(
      "Encrypted replication destination must differ from the active database location.",
    );
  }
  const now = validDate(
    options.now ?? new Date(),
    "Encrypted replication now",
  );
  const snapshotDirectory = directName(
    options.snapshotDirectory,
    "snapshotDirectory",
  );
  const keyId = keyIdentifier(options.keyId);
  if (options.masterKey.byteLength !== 32) {
    throw new Error("Encrypted replication masterKey must be exactly 32 bytes.");
  }
  const identity = databaseSafeguardIdentity(databasePath);
  requireDirectFile(databasePath, "The active database");
  mkdirSync(sourceBackupDirectory, { recursive: true });
  mkdirSync(destinationDirectory, { recursive: true });
  requireDirectDirectory(sourceBackupDirectory, "Local backup destination");
  requireDirectDirectory(destinationDirectory, "Replication destination");
  const key = masterKey(options.masterKey);
  const lockPath = join(
    sourceBackupDirectory,
    `automatic-backup-${identity.slice(0, 16)}.lock`,
  );
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch (error) {
    key.fill(0);
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        "Another backup, retention, restore, or replication operation is in progress.",
      );
    }
    throw error;
  }
  let packageDirectory: string | null = null;
  try {
    const catalog = catalogDatabaseSnapshots({
      databasePath,
      outputDirectory: sourceBackupDirectory,
      now,
    });
    const selected = catalog.verifiedSnapshots.find(
      ({ directory }) => directory === snapshotDirectory,
    );
    if (selected === undefined) {
      const inspected = catalog.snapshots.find(
        ({ directory }) => directory === snapshotDirectory,
      );
      throw new Error(
        inspected === undefined
          ? "Selected recovery point does not exist in the local backup destination."
          : `Selected recovery point is protected and not verifiable: ${inspected.problems.join("; ")}`,
      );
    }
    const safeguardManifest = JSON.parse(
      readFileSync(selected.manifestPath, "utf8"),
    ) as DatabaseSafeguardManifest;
    const verification = verifyDatabaseAgainstManifest({
      databasePath: selected.backupPath,
      manifestPath: selected.manifestPath,
    });
    if (
      !verification.passed ||
      safeguardManifest.formatVersion !== 1 ||
      safeguardManifest.sourceDatabase !== basename(databasePath) ||
      safeguardManifest.sourceDatabaseIdentity !== identity ||
      safeguardManifest.backupFile !== basename(selected.backupPath) ||
      safeguardManifest.createdAt !== selected.createdAt ||
      safeguardManifest.backupSha256 !== (await hashFile(selected.backupPath))
    ) {
      throw new Error("Selected recovery point changed during verification.");
    }

    const packageId = randomUUID();
    const createdAt = now.toISOString();
    const packageSalt = randomBytes(32);
    const packageName = `offsite-${timestampForFilename(now)}-${packageId}`;
    packageDirectory = join(destinationDirectory, packageName);
    mkdirSync(packageDirectory);
    const manifestContext = {
      createdAt,
      keyId,
      packageId,
      snapshotDirectory,
      sourceDatabaseIdentity: identity,
    };
    const sources: Array<{
      encryptedFile: string;
      logicalName: ReplicatedLogicalFile;
      sourcePath: string;
    }> = [
      {
        encryptedFile: "database.enc",
        logicalName: "database",
        sourcePath: selected.backupPath,
      },
      {
        encryptedFile: "safeguard-manifest.enc",
        logicalName: "safeguard-manifest",
        sourcePath: selected.manifestPath,
      },
      {
        encryptedFile: "durable-data-export.enc",
        logicalName: "durable-data-export",
        sourcePath: join(
          sourceBackupDirectory,
          selected.directory,
          "durable-data-export.json",
        ),
      },
    ];
    for (const source of sources) {
      requireDirectFile(source.sourcePath, `Replication source ${source.logicalName}`);
    }
    const files: EncryptedReplicationFile[] = [];
    try {
      for (const source of sources) {
        files.push(
          await encryptFile({
            destinationPath: join(packageDirectory, source.encryptedFile),
            key,
            logicalName: source.logicalName,
            manifestContext,
            salt: packageSalt,
            sourcePath: source.sourcePath,
          }),
        );
      }
      const manifest: EncryptedReplicationManifest = {
        algorithm: "aes-256-gcm",
        createdAt,
        files,
        formatVersion: encryptedReplicationManifestFormatVersion,
        kdf: "hkdf-sha256",
        keyId,
        packageId,
        packageSaltBase64: packageSalt.toString("base64"),
        snapshotCreatedAt: selected.createdAt,
        snapshotDirectory,
        sourceDatabase: basename(databasePath),
        sourceDatabaseIdentity: identity,
      };
      const manifestPath = join(packageDirectory, "replication-manifest.json");
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      const verificationResult = await verifyEncryptedReplication({
        masterKey: key,
        now,
        packageDirectory,
      });
      return {
        manifest,
        manifestPath,
        packageDirectory,
        verification: verificationResult,
      };
    } catch (error) {
      rmSync(packageDirectory, { force: true, recursive: true });
      packageDirectory = null;
      throw error;
    } finally {
      packageSalt.fill(0);
    }
  } finally {
    key.fill(0);
    closeSync(lock);
    rmSync(lockPath, { force: true });
  }
}
