import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ExplicitHostMutationContext } from "../platform/host-platform.js";
import type { WindowsContinuityDeploymentPlan } from "../platform/windows-continuity-deployment.js";
import {
  applyWindowsHostInstallation,
  applyWindowsHostRemoval,
  previewWindowsHostInstallation,
  previewWindowsHostRemoval,
  type WindowsHostInstallationPreview,
  type WindowsHostOperations,
} from "../platform/windows-host-integration.js";
import type { WindowsManagedScheduleValidation } from "../platform/windows-powershell-host-operations.js";
import { verifyWindowsContinuityBundle } from "../packaging/windows-continuity-bundle.js";
import {
  continuityReleaseWorkspaceMarkerFilename,
  continuityReleaseWorkspaceMarkerFormatVersion,
  type ContinuityReleaseWorkspaceMarker,
} from "./continuity-release-validation-service.js";
import { verifyContinuityHostAcceptance } from "./continuity-installation-acceptance-service.js";

export const windowsElevatedHostValidationFormatVersion = 1 as const;

export interface WindowsElevatedHostValidationPreview {
  confirmation: string;
  dataPathsPreserved: readonly string[];
  hostInstallation: WindowsHostInstallationPreview;
  operation: "validate-elevated-host-lifecycle";
  scheduleId: string;
  workspaceDirectory: string;
}

export interface WindowsElevatedHostValidationReport {
  completedAt: string;
  formatVersion: typeof windowsElevatedHostValidationFormatVersion;
  hostAccepted: true;
  hostRemoved: true;
  passed: true;
  reportPath: string;
  scheduleValidation: WindowsManagedScheduleValidation;
  syntheticDataOnly: true;
  workspaceDirectory: string;
}

export interface WindowsElevatedHostValidationOptions {
  operations: WindowsHostOperations;
  plan: WindowsContinuityDeploymentPlan;
  scheduleValidator: (
    scheduleId: string,
  ) => Promise<WindowsManagedScheduleValidation>;
  workspaceDirectory: string;
}

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

function parseMarker(path: string): ContinuityReleaseWorkspaceMarker {
  directFile(path, "Release validation workspace marker");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Release validation workspace marker is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Release validation workspace marker must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    JSON.stringify(keys) !==
      JSON.stringify([
        "candidateManifestSha256",
        "candidatePublisherFingerprint256",
        "formatVersion",
        "syntheticDataOnly",
      ]) ||
    record.formatVersion !== continuityReleaseWorkspaceMarkerFormatVersion ||
    record.syntheticDataOnly !== true ||
    typeof record.candidateManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.candidateManifestSha256) ||
    typeof record.candidatePublisherFingerprint256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.candidatePublisherFingerprint256)
  ) {
    throw new Error("Release validation workspace marker is invalid.");
  }
  return record as unknown as ContinuityReleaseWorkspaceMarker;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function confirmation(value: unknown): string {
  return `VALIDATE-WINDOWS-HOST-${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
    .slice(0, 20)
    .toUpperCase()}`;
}

function writeJsonOnce(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function validatedBoundary(
  options: WindowsElevatedHostValidationOptions,
): Promise<{
  hostInstallation: WindowsHostInstallationPreview;
  marker: ContinuityReleaseWorkspaceMarker;
  scheduleId: string;
  workspaceDirectory: string;
}> {
  const workspaceDirectory = resolve(options.workspaceDirectory);
  if (!isAbsolute(options.workspaceDirectory)) {
    throw new Error("Elevated host validation workspace must be an absolute path.");
  }
  directDirectory(workspaceDirectory, "Elevated host validation workspace");
  const marker = parseMarker(
    join(workspaceDirectory, continuityReleaseWorkspaceMarkerFilename),
  );
  const deployment = options.plan.deployment;
  if (
    resolve(deployment.databasePath) !==
      resolve(workspaceDirectory, "data", "memtextual.db") ||
    resolve(deployment.backupDirectory) !==
      resolve(workspaceDirectory, "host-validation-backups") ||
    resolve(deployment.stateDirectory) !==
      resolve(workspaceDirectory, "host-validation-state")
  ) {
    throw new Error(
      "Elevated host validation must use the release workspace database and its dedicated host-validation-backups and host-validation-state paths.",
    );
  }
  directDirectory(
    deployment.backupDirectory,
    "Elevated host validation backup directory",
  );
  if (readdirSync(deployment.backupDirectory).length > 0) {
    throw new Error("Elevated host validation backup directory must be empty.");
  }
  if (existsSync(deployment.stateDirectory)) {
    throw new Error("Elevated host validation state directory must not exist.");
  }
  if (!/^MTValidate[A-Za-z0-9._-]{0,10}$/u.test(deployment.identityName)) {
    throw new Error(
      "Elevated host validation identityName must start with MTValidate and use no more than 20 safe characters.",
    );
  }
  if (deployment.offsite !== undefined || options.plan.host.schedules.length !== 1) {
    throw new Error(
      "Elevated host validation currently requires a backup-only deployment with exactly one schedule.",
    );
  }
  const bundle = await verifyWindowsContinuityBundle({
    bundleDirectory: deployment.applicationDirectory,
    trustedCertificateFingerprint256: marker.candidatePublisherFingerprint256,
  });
  if (
    !bundle.publisherTrusted ||
    bundle.manifestSha256 !== marker.candidateManifestSha256
  ) {
    throw new Error(
      "Elevated host validation application does not match the release-validated candidate.",
    );
  }
  const hostInstallation = await previewWindowsHostInstallation(
    options.operations,
    options.plan.host,
  );
  if (
    hostInstallation.currentIdentity.available ||
    hostInstallation.currentSchedules.some(({ installed }) => installed)
  ) {
    throw new Error(
      "Elevated host validation requires its dedicated identity and schedules to be absent before installation.",
    );
  }
  return {
    hostInstallation,
    marker,
    scheduleId: options.plan.host.schedules[0]!.scheduleId,
    workspaceDirectory,
  };
}

export async function previewWindowsElevatedHostValidation(
  options: WindowsElevatedHostValidationOptions,
): Promise<WindowsElevatedHostValidationPreview> {
  const boundary = await validatedBoundary(options);
  const previewWithoutConfirmation = {
    dataPathsPreserved: options.plan.host.protectedPaths.map(({ path }) => path),
    hostInstallation: boundary.hostInstallation,
    operation: "validate-elevated-host-lifecycle" as const,
    scheduleId: boundary.scheduleId,
    workspaceDirectory: boundary.workspaceDirectory,
  };
  return {
    confirmation: confirmation({
      marker: boundary.marker,
      preview: previewWithoutConfirmation,
    }),
    ...previewWithoutConfirmation,
  };
}

export async function applyWindowsElevatedHostValidation(
  options: WindowsElevatedHostValidationOptions & {
    confirmation: string;
    context: ExplicitHostMutationContext;
  },
): Promise<WindowsElevatedHostValidationReport> {
  const preview = await previewWindowsElevatedHostValidation(options);
  if (options.confirmation !== preview.confirmation) {
    throw new Error(
      "Elevated host validation confirmation is missing, incorrect, or stale.",
    );
  }
  const reportPath = join(
    preview.workspaceDirectory,
    "elevated-host-validation-report.json",
  );
  const failurePath = join(
    preview.workspaceDirectory,
    "elevated-host-validation-failure.json",
  );
  if (existsSync(reportPath) || existsSync(failurePath)) {
    throw new Error("Elevated host validation evidence already exists in this workspace.");
  }
  let installationAttempted = false;
  try {
    installationAttempted = true;
    await applyWindowsHostInstallation(
      options.operations,
      options.plan.host,
      preview.hostInstallation.confirmation,
      options.context,
    );
    verifyContinuityHostAcceptance(
      await previewWindowsHostInstallation(options.operations, options.plan.host),
    );
    const scheduleValidation = await options.scheduleValidator(preview.scheduleId);
    if (
      !readdirSync(options.plan.deployment.backupDirectory).some((name) =>
        name.startsWith("memtextual-"),
      )
    ) {
      throw new Error("Validated Windows schedule did not create a backup recovery point.");
    }
    const removal = await previewWindowsHostRemoval(
      options.operations,
      options.plan.host,
    );
    await applyWindowsHostRemoval(
      options.operations,
      options.plan.host,
      removal.confirmation,
      options.context,
    );
    installationAttempted = false;
    const absent = await previewWindowsHostInstallation(
      options.operations,
      options.plan.host,
    );
    if (
      absent.currentIdentity.available ||
      absent.currentSchedules.some(({ installed }) => installed) ||
      !existsSync(options.plan.deployment.databasePath) ||
      !existsSync(
        join(
          preview.workspaceDirectory,
          continuityReleaseWorkspaceMarkerFilename,
        ),
      )
    ) {
      throw new Error(
        "Elevated host validation cleanup did not remove host resources while preserving synthetic data.",
      );
    }
    const report: WindowsElevatedHostValidationReport = {
      completedAt: new Date().toISOString(),
      formatVersion: windowsElevatedHostValidationFormatVersion,
      hostAccepted: true,
      hostRemoved: true,
      passed: true,
      reportPath,
      scheduleValidation,
      syntheticDataOnly: true,
      workspaceDirectory: preview.workspaceDirectory,
    };
    writeJsonOnce(reportPath, report);
    return report;
  } catch (error) {
    let cleanupError: string | null = null;
    if (installationAttempted) {
      try {
        const removal = await previewWindowsHostRemoval(
          options.operations,
          options.plan.host,
        );
        if (
          removal.identityWillBeRemoved ||
          removal.schedulesWillBeRemoved.length > 0
        ) {
          await applyWindowsHostRemoval(
            options.operations,
            options.plan.host,
            removal.confirmation,
            options.context,
          );
        }
      } catch (cleanupFailure) {
        cleanupError =
          cleanupFailure instanceof Error
            ? cleanupFailure.message
            : "Unknown elevated host cleanup failure";
      }
    }
    writeJsonOnce(failurePath, {
      cleanupError,
      failedAt: new Date().toISOString(),
      formatVersion: windowsElevatedHostValidationFormatVersion,
      message: error instanceof Error ? error.message : "Unknown elevated host validation failure",
      passed: false,
      syntheticDataOnly: true,
      workspaceDirectory: preview.workspaceDirectory,
    });
    const message = error instanceof Error ? error.message : "Unknown elevated host validation failure";
    throw new Error(
      cleanupError === null
        ? message
        : `${message} Cleanup failed and requires immediate manual attention: ${cleanupError}`,
    );
  }
}
