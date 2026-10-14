import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const replicationDestinationReceiptFormatVersion = 1 as const;

export interface ReplicationDestinationArtifact {
  bytes: number;
  filename: string;
  sha256: string;
}

export interface ReplicationDestinationPublishRequest {
  artifacts: ReplicationDestinationArtifact[];
  packageId: string;
  packageName: string;
  sourceDirectory: string;
}

export interface ReplicationDestinationPublishResult {
  artifacts: ReplicationDestinationArtifact[];
  packageReference: string;
}

export interface ReplicationDestinationPackageRequest {
  artifacts: ReplicationDestinationArtifact[];
  packageName: string;
}

export interface ReplicationDestinationMaterializeRequest
  extends ReplicationDestinationPackageRequest {
  destinationDirectory: string;
}

export interface ReplicationDestinationMaterializeResult {
  artifacts: ReplicationDestinationArtifact[];
  packageDirectory: string;
}

export interface ReplicationDestinationAdapter {
  adapterId: string;
  adapterVersion: string;
  destinationIdentity: string;
  publishPackage(
    request: ReplicationDestinationPublishRequest,
  ): Promise<ReplicationDestinationPublishResult>;
  removePackage(input: { packageName: string }): Promise<void>;
  destinationAvailable?(): Promise<boolean>;
  packageExists?(
    request: ReplicationDestinationPackageRequest,
  ): Promise<boolean>;
  materializePackage?(
    request: ReplicationDestinationMaterializeRequest,
  ): Promise<ReplicationDestinationMaterializeResult>;
}

export interface PublishReplicationPackageOptions {
  adapter: ReplicationDestinationAdapter;
  now?: Date;
  packageDirectory: string;
  receiptDirectory: string;
}

export interface ReplicationDestinationReceipt {
  adapterId: string;
  adapterVersion: string;
  artifacts: ReplicationDestinationArtifact[];
  destinationIdentity: string;
  formatVersion: typeof replicationDestinationReceiptFormatVersion;
  packageId: string;
  packageName: string;
  packageReference: string;
  publishedAt: string;
  receiptId: string;
  receiptPath: string;
}

interface ReplicationManifestShape {
  files?: Array<{
    ciphertextBytes?: unknown;
    ciphertextSha256?: unknown;
    encryptedFile?: unknown;
  }>;
  formatVersion?: unknown;
  packageId?: unknown;
}

interface ReplicationVerificationShape {
  checkedTables?: unknown;
  fileCount?: unknown;
  formatVersion?: unknown;
  manifestSha256?: unknown;
  packageId?: unknown;
  passed?: unknown;
}

const coreArtifactNames = new Set([
  "database.enc",
  "durable-data-export.enc",
  "replication-manifest.json",
  "safeguard-manifest.enc",
]);

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function directName(value: string, label: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    basename(value) !== value ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(`${label} must be a direct name.`);
  }
  return value;
}

function adapterIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(
      `${label} must use 1-128 letters, numbers, periods, underscores, or hyphens.`,
    );
  }
  return value;
}

function destinationIdentifier(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new Error("Replication destination identity is invalid.");
  }
  return value;
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

function directDirectoryExists(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const stats = lstatSync(path);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
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

async function measureFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function validArtifactName(filename: string): boolean {
  return (
    coreArtifactNames.has(filename) ||
    /^verification-[A-Za-z0-9._-]+\.json$/u.test(filename)
  );
}

async function inspectPackage(
  packageDirectory: string,
): Promise<{
  artifacts: ReplicationDestinationArtifact[];
  packageId: string;
  packageName: string;
}> {
  requireDirectDirectory(packageDirectory, "Encrypted replication package");
  const packageName = directName(
    basename(packageDirectory),
    "Encrypted replication package name",
  );
  if (!packageName.startsWith("offsite-")) {
    throw new Error("Encrypted replication package name must start with offsite-.");
  }
  const filenames = readdirSync(packageDirectory).sort();
  const verificationFilenames = filenames.filter((filename) =>
    /^verification-[A-Za-z0-9._-]+\.json$/u.test(filename),
  );
  if (
    filenames.length < coreArtifactNames.size + 1 ||
    verificationFilenames.length === 0 ||
    filenames.some((filename) => !validArtifactName(filename))
  ) {
    throw new Error(
      "Encrypted replication package contains missing or unexpected artifacts.",
    );
  }
  for (const required of coreArtifactNames) {
    if (!filenames.includes(required)) {
      throw new Error(`Encrypted replication package is missing ${required}.`);
    }
  }
  const manifestPath = join(packageDirectory, "replication-manifest.json");
  requireDirectFile(manifestPath, "Encrypted replication manifest");
  let manifest: ReplicationManifestShape;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReplicationManifestShape;
  } catch {
    throw new Error("Encrypted replication manifest is not valid JSON.");
  }
  if (
    manifest.formatVersion !== 1 ||
    typeof manifest.packageId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(manifest.packageId) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Encrypted replication manifest identity is invalid.");
  }
  const manifestEncryptedFiles = manifest.files.map((file) => {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.encryptedFile !== "string" ||
      !Number.isSafeInteger(file.ciphertextBytes) ||
      (file.ciphertextBytes as number) < 0 ||
      typeof file.ciphertextSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.ciphertextSha256)
    ) {
      throw new Error("Encrypted replication manifest artifact evidence is invalid.");
    }
    return {
      bytes: file.ciphertextBytes as number,
      filename: file.encryptedFile,
      sha256: file.ciphertextSha256,
    };
  });
  if (
    manifestEncryptedFiles.length !== 3 ||
    manifestEncryptedFiles
      .map(({ filename }) => filename)
      .sort()
      .join("\n") !==
      ["database.enc", "durable-data-export.enc", "safeguard-manifest.enc"]
        .sort()
        .join("\n")
  ) {
    throw new Error("Encrypted replication manifest artifact list is invalid.");
  }
  const artifacts: ReplicationDestinationArtifact[] = [];
  for (const filename of filenames) {
    const path = join(packageDirectory, filename);
    requireDirectFile(path, `Replication artifact ${filename}`);
    artifacts.push({ filename, ...(await measureFile(path)) });
  }
  for (const expected of manifestEncryptedFiles) {
    const measured = artifacts.find(
      ({ filename }) => filename === expected.filename,
    );
    if (
      measured?.bytes !== expected.bytes ||
      measured.sha256 !== expected.sha256
    ) {
      throw new Error(
        `Encrypted replication artifact does not match its manifest: ${expected.filename}.`,
      );
    }
  }
  const manifestArtifact = artifacts.find(
    ({ filename }) => filename === "replication-manifest.json",
  );
  if (manifestArtifact === undefined) {
    throw new Error("Encrypted replication manifest measurement is missing.");
  }
  for (const filename of verificationFilenames) {
    let verification: ReplicationVerificationShape;
    try {
      verification = JSON.parse(
        readFileSync(join(packageDirectory, filename), "utf8"),
      ) as ReplicationVerificationShape;
    } catch {
      throw new Error(`Replication verification report is not valid JSON: ${filename}.`);
    }
    if (
      verification.formatVersion !== 1 ||
      verification.passed !== true ||
      verification.packageId !== manifest.packageId ||
      verification.fileCount !== 3 ||
      !Number.isSafeInteger(verification.checkedTables) ||
      (verification.checkedTables as number) < 1 ||
      verification.manifestSha256 !== manifestArtifact.sha256
    ) {
      throw new Error(
        `Replication verification report does not match the package: ${filename}.`,
      );
    }
  }
  return { artifacts, packageId: manifest.packageId, packageName };
}

function normalizedArtifacts(
  value: unknown,
  label: string,
): ReplicationDestinationArtifact[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must contain an artifact array.`);
  }
  const filenames = new Set<string>();
  const artifacts = value.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`${label} artifact ${index} is invalid.`);
    }
    const artifact = candidate as Partial<ReplicationDestinationArtifact>;
    if (
      typeof artifact.filename !== "string" ||
      !validArtifactName(artifact.filename) ||
      typeof artifact.bytes !== "number" ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
      filenames.has(artifact.filename)
    ) {
      throw new Error(`${label} artifact ${index} is invalid.`);
    }
    filenames.add(artifact.filename);
    return {
      bytes: artifact.bytes,
      filename: artifact.filename,
      sha256: artifact.sha256,
    };
  });
  return artifacts.sort((left, right) => left.filename.localeCompare(right.filename));
}

function sameArtifacts(
  expected: ReplicationDestinationArtifact[],
  actual: ReplicationDestinationArtifact[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (artifact, index) =>
        artifact.bytes === actual[index]?.bytes &&
        artifact.filename === actual[index]?.filename &&
        artifact.sha256 === actual[index]?.sha256,
    )
  );
}

export async function publishReplicationPackage(
  options: PublishReplicationPackageOptions,
): Promise<ReplicationDestinationReceipt> {
  const packageDirectory = resolve(options.packageDirectory);
  const receiptDirectory = resolve(options.receiptDirectory);
  if (
    isWithin(packageDirectory, receiptDirectory) ||
    isWithin(receiptDirectory, packageDirectory)
  ) {
    throw new Error(
      "Replication receipt storage must not overlap the encrypted package.",
    );
  }
  const adapterId = adapterIdentifier(options.adapter.adapterId, "Adapter id");
  const adapterVersion = adapterIdentifier(
    options.adapter.adapterVersion,
    "Adapter version",
  );
  const destinationIdentity = destinationIdentifier(
    options.adapter.destinationIdentity,
  );
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Replication publication now must be a valid date.");
  }
  const inspected = await inspectPackage(packageDirectory);
  mkdirSync(receiptDirectory, { recursive: true });
  requireDirectDirectory(receiptDirectory, "Replication receipt destination");
  let published = false;
  try {
    const result = await options.adapter.publishPackage({
      artifacts: inspected.artifacts.map((artifact) => ({ ...artifact })),
      packageId: inspected.packageId,
      packageName: inspected.packageName,
      sourceDirectory: packageDirectory,
    });
    published = true;
    const unchangedSource = await inspectPackage(packageDirectory);
    if (
      unchangedSource.packageId !== inspected.packageId ||
      unchangedSource.packageName !== inspected.packageName ||
      !sameArtifacts(
        [...inspected.artifacts].sort((left, right) =>
          left.filename.localeCompare(right.filename),
        ),
        [...unchangedSource.artifacts].sort((left, right) =>
          left.filename.localeCompare(right.filename),
        ),
      )
    ) {
      throw new Error("Replication adapter changed the source package.");
    }
    if (typeof result !== "object" || result === null) {
      throw new Error("Replication adapter returned an invalid publication result.");
    }
    if (
      typeof result.packageReference !== "string" ||
      result.packageReference !== result.packageReference.trim() ||
      !/^[^\u0000-\u001f\u007f]{1,1024}$/u.test(result.packageReference)
    ) {
      throw new Error("Replication adapter returned an invalid package reference.");
    }
    const actualArtifacts = normalizedArtifacts(
      result.artifacts,
      "Replication adapter result",
    );
    const expectedArtifacts = [...inspected.artifacts].sort((left, right) =>
      left.filename.localeCompare(right.filename),
    );
    if (!sameArtifacts(expectedArtifacts, actualArtifacts)) {
      throw new Error(
        "Replication adapter result does not prove byte-for-byte artifact parity.",
      );
    }
    const publishedAt = now.toISOString();
    const receiptId = randomUUID();
    const receiptPath = join(
      receiptDirectory,
      `destination-${publishedAt.replaceAll(":", "-").replace(".", "-")}-${receiptId}.json`,
    );
    const receipt: ReplicationDestinationReceipt = {
      adapterId,
      adapterVersion,
      artifacts: actualArtifacts,
      destinationIdentity,
      formatVersion: replicationDestinationReceiptFormatVersion,
      packageId: inspected.packageId,
      packageName: inspected.packageName,
      packageReference: result.packageReference,
      publishedAt,
      receiptId,
      receiptPath,
    };
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return receipt;
  } catch (error) {
    if (published) {
      try {
        await options.adapter.removePackage({
          packageName: inspected.packageName,
        });
      } catch (cleanupError) {
        throw new Error(
          `Replication destination rejected its publication result and rollback failed. Publication error: ${error instanceof Error ? error.message : "unknown publication failure"}. Rollback error: ${cleanupError instanceof Error ? cleanupError.message : "unknown rollback failure"}.`,
        );
      }
    }
    throw error;
  }
}

export function createLocalDirectoryReplicationAdapter(
  destinationDirectory: string,
): ReplicationDestinationAdapter {
  const destination = resolve(destinationDirectory);
  const stableDestination =
    process.platform === "win32" ? destination.toLowerCase() : destination;
  const destinationIdentity = createHash("sha256")
    .update(stableDestination, "utf8")
    .digest("hex");
  return {
    adapterId: "local-directory",
    adapterVersion: "1",
    destinationIdentity,
    async destinationAvailable() {
      return directDirectoryExists(destination);
    },
    async publishPackage(request) {
      requireDirectDirectory(destination, "Replication destination");
      const sourceDirectory = resolve(request.sourceDirectory);
      requireDirectDirectory(sourceDirectory, "Encrypted replication package");
      if (
        isWithin(sourceDirectory, destination) ||
        isWithin(destination, sourceDirectory)
      ) {
        throw new Error(
          "Replication destination must not overlap the encrypted package.",
        );
      }
      const packageName = directName(request.packageName, "Package name");
      const targetDirectory = join(destination, packageName);
      let targetCreated = false;
      try {
        mkdirSync(targetDirectory);
        targetCreated = true;
        const copied: ReplicationDestinationArtifact[] = [];
        for (const artifact of request.artifacts) {
          const filename = directName(artifact.filename, "Artifact filename");
          const sourcePath = join(sourceDirectory, filename);
          const targetPath = join(targetDirectory, filename);
          requireDirectFile(sourcePath, `Replication artifact ${filename}`);
          copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
          copied.push({ filename, ...(await measureFile(targetPath)) });
        }
        return {
          artifacts: copied,
          packageReference: targetDirectory,
        };
      } catch (error) {
        if (targetCreated) {
          rmSync(targetDirectory, { force: true, recursive: true });
        }
        throw error;
      }
    },
    async removePackage({ packageName }) {
      const directPackageName = directName(packageName, "Package name");
      const targetDirectory = join(destination, directPackageName);
      const relativeTarget = relative(destination, targetDirectory);
      if (
        relativeTarget.startsWith("..") ||
        isAbsolute(relativeTarget) ||
        basename(targetDirectory) !== directPackageName
      ) {
        throw new Error("Unsafe replication rollback target.");
      }
      rmSync(targetDirectory, { force: true, recursive: true });
    },
    async packageExists(request) {
      const packageName = directName(request.packageName, "Package name");
      const targetDirectory = join(destination, packageName);
      try {
        requireDirectDirectory(targetDirectory, "Published replication package");
        const filenames = readdirSync(targetDirectory).sort();
        const expected = request.artifacts
          .map(({ filename }) => directName(filename, "Artifact filename"))
          .sort();
        return (
          filenames.length === expected.length &&
          filenames.every((filename, index) => filename === expected[index])
        );
      } catch {
        return false;
      }
    },
    async materializePackage(request) {
      const packageName = directName(request.packageName, "Package name");
      const publishedDirectory = join(destination, packageName);
      requireDirectDirectory(publishedDirectory, "Published replication package");
      const materializationRoot = resolve(request.destinationDirectory);
      requireDirectDirectory(
        materializationRoot,
        "Replication materialization destination",
      );
      const targetDirectory = join(materializationRoot, packageName);
      let targetCreated = false;
      try {
        mkdirSync(targetDirectory);
        targetCreated = true;
        const copied: ReplicationDestinationArtifact[] = [];
        for (const artifact of request.artifacts) {
          const filename = directName(artifact.filename, "Artifact filename");
          const sourcePath = join(publishedDirectory, filename);
          const targetPath = join(targetDirectory, filename);
          requireDirectFile(sourcePath, `Published replication artifact ${filename}`);
          copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
          const measured = await measureFile(targetPath);
          if (
            measured.bytes !== artifact.bytes ||
            measured.sha256 !== artifact.sha256
          ) {
            throw new Error(
              `Published replication artifact failed byte-for-byte verification: ${filename}.`,
            );
          }
          copied.push({ filename, ...measured });
        }
        return { artifacts: copied, packageDirectory: targetDirectory };
      } catch (error) {
        if (targetCreated) {
          rmSync(targetDirectory, { force: true, recursive: true });
        }
        throw error;
      }
    },
  };
}
