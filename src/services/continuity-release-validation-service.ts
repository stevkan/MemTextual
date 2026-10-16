import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import {
  applyWindowsContinuityBundleRemoval,
  applyWindowsContinuityBundleStage,
  previewWindowsContinuityBundleRemoval,
  previewWindowsContinuityBundleStage,
} from "../packaging/windows-continuity-bundle.js";
import { SqliteMemoryRepository } from "../repositories/sqlite-memory-repository.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { applyGuidedRestore, previewGuidedRestore } from "../safeguards/guided-restore.js";
import {
  createEncryptedReplication,
  importEncryptedReplication,
  verifyEncryptedReplication,
} from "../safeguards/encrypted-replication.js";
import { runAutomaticBackupIfDue } from "../safeguards/automatic-backup.js";
import { runRestoreDrillIfDue } from "../safeguards/restore-drill.js";
import { validateContinuityUpgrade } from "../safeguards/continuity-upgrade-validation.js";
import { ContinuityOnboardingService } from "./continuity-onboarding-service.js";
import { verifyContinuityDatabaseAcceptance } from "./continuity-installation-acceptance-service.js";
import { MemoryService } from "./memory-service.js";

export const continuityReleaseValidationFormatVersion = 1 as const;
export const continuityReleaseWorkspaceMarkerFormatVersion = 1 as const;
export const continuityReleaseWorkspaceMarkerFilename =
  ".memtextual-release-validation.json";

export interface ContinuityReleaseWorkspaceMarker {
  candidateManifestSha256: string;
  candidatePublisherFingerprint256: string;
  formatVersion: typeof continuityReleaseWorkspaceMarkerFormatVersion;
  syntheticDataOnly: true;
}

export interface ContinuityReleaseValidationOptions {
  baselineMigrationsDirectory: string;
  bundleDirectory: string;
  now?: Date;
  trustedCertificateFingerprint256: string;
  workspaceDirectory: string;
}

export interface ContinuityReleaseValidationPhase {
  id: string;
  passed: true;
  summary: string;
}

export interface ContinuityReleaseValidationReport {
  completedAt: string;
  formatVersion: typeof continuityReleaseValidationFormatVersion;
  passed: true;
  phases: ContinuityReleaseValidationPhase[];
  privilegedHostValidation: {
    reason: string;
    status: "not_run";
  };
  reportPath: string;
  startedAt: string;
  syntheticDataOnly: true;
  workspaceDirectory: string;
}

function requireDirectDirectory(path: string, label: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}.`);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory: ${path}.`);
  }
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function at(startedAt: Date, hours: number): Date {
  return new Date(startedAt.getTime() + hours * 60 * 60 * 1_000);
}

function migrationVersion(databasePath: string): number {
  const database = openMemTextualDatabase({ filename: databasePath, readonly: true });
  try {
    return (
      database
        .prepare("SELECT max(version) AS version FROM schema_migrations")
        .get() as { version: number }
    ).version;
  } finally {
    database.close();
  }
}

function writeReport(path: string, report: unknown): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function validateContinuityReleaseCandidate(
  options: ContinuityReleaseValidationOptions,
): Promise<ContinuityReleaseValidationReport> {
  const bundleDirectory = resolve(options.bundleDirectory);
  const baselineMigrationsDirectory = resolve(options.baselineMigrationsDirectory);
  const workspaceDirectory = resolve(options.workspaceDirectory);
  if (!isAbsolute(options.workspaceDirectory)) {
    throw new Error("Release validation workspace must be an absolute path.");
  }
  requireDirectDirectory(bundleDirectory, "Release candidate bundle");
  requireDirectDirectory(baselineMigrationsDirectory, "Baseline migrations directory");
  requireDirectDirectory(dirname(workspaceDirectory), "Release validation workspace parent");
  if (existsSync(workspaceDirectory)) {
    throw new Error("Release validation workspace must not already exist.");
  }
  if (
    isWithin(bundleDirectory, workspaceDirectory) ||
    isWithin(workspaceDirectory, bundleDirectory) ||
    isWithin(baselineMigrationsDirectory, workspaceDirectory) ||
    isWithin(workspaceDirectory, baselineMigrationsDirectory)
  ) {
    throw new Error("Release validation inputs and workspace must not overlap.");
  }
  const startedAt = options.now ?? new Date();
  if (Number.isNaN(startedAt.getTime())) {
    throw new Error("Release validation time is invalid.");
  }

  mkdirSync(workspaceDirectory);
  const reportPath = join(workspaceDirectory, "release-validation-report.json");
  const failurePath = join(workspaceDirectory, "release-validation-failure.json");
  const phases: ContinuityReleaseValidationPhase[] = [];
  const stagedApplication = join(workspaceDirectory, "application");
  const databasePath = join(workspaceDirectory, "data", "memtextual.db");
  const backupsDirectory = join(workspaceDirectory, "backups");
  const offsiteDirectory = join(workspaceDirectory, "offsite");
  const importedDirectory = join(workspaceDirectory, "imported-recovery");
  const upgradeDirectory = join(workspaceDirectory, "upgrade-backups");
  mkdirSync(dirname(databasePath));
  mkdirSync(offsiteDirectory);
  mkdirSync(importedDirectory);
  const masterKey = randomBytes(32);
  let memoryId = "";
  let personaId = "";
  let baselineVersion = 0;

  try {
    const stagePreview = await previewWindowsContinuityBundleStage({
      bundleDirectory,
      targetDirectory: stagedApplication,
      trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
    });
    const staged = await applyWindowsContinuityBundleStage({
      bundleDirectory,
      confirmation: stagePreview.confirmation,
      targetDirectory: stagedApplication,
      trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
    });
    phases.push({ id: "package-installation", passed: true, summary: "Verified and staged the signed candidate into an absent disposable application directory." });

    const initial = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: baselineMigrationsDirectory,
    });
    try {
      const memories = new MemoryService(new SqliteMemoryRepository(initial));
      const scope = memories.createScope({ kind: "project", name: "Release validation" });
      const memory = memories.create({
        assertion: "Synthetic release-validation memory.",
        scopeId: scope.id,
        type: "fact",
      });
      memoryId = memory.id;
      const retrieved = memories.retrieve({
        scopeIds: [scope.id],
        text: "release validation",
      });
      if (!retrieved.some(({ memory: candidate }) => candidate.id === memory.id)) {
        throw new Error("Synthetic memory could not be retrieved after creation.");
      }
      const onboarding = new ContinuityOnboardingService(
        new SqlitePersonaRepository(initial),
      ).setup({ personaName: "Release Validator", userDisplayName: "Synthetic User" });
      personaId = onboarding.personaContext.persona.id;
    } finally {
      initial.close();
    }
    baselineVersion = migrationVersion(databasePath);
    phases.push({ id: "database-and-memory", passed: true, summary: `Created baseline schema ${baselineVersion}, a synthetic persona, and a retrievable synthetic memory.` });

    const backup = await runAutomaticBackupIfDue({
      databasePath,
      intervalHours: 24,
      now: at(startedAt, 1),
      outputDirectory: backupsDirectory,
    });
    if (backup.outcome !== "created" || backup.snapshot === undefined) {
      throw new Error("Initial automatic backup was not created.");
    }
    const drill = runRestoreDrillIfDue({
      databasePath,
      intervalHours: 24,
      now: at(startedAt, 2),
      outputDirectory: backupsDirectory,
    });
    if (drill.outcome !== "performed" || drill.report?.passed !== true) {
      throw new Error("Restore drill did not complete successfully.");
    }
    phases.push({ id: "backup-and-restore-drill", passed: true, summary: "Created a verified backup and restored it into a disposable drill database." });

    const snapshotDirectory = basename(dirname(backup.snapshot.backupPath));
    const replication = await createEncryptedReplication({
      databasePath,
      destinationDirectory: offsiteDirectory,
      keyId: "release-validation-ephemeral-key",
      masterKey,
      now: at(startedAt, 3),
      snapshotDirectory,
      sourceBackupDirectory: backupsDirectory,
    });
    await verifyEncryptedReplication({
      masterKey,
      now: at(startedAt, 4),
      packageDirectory: replication.packageDirectory,
    });
    await importEncryptedReplication({
      databasePath,
      destinationDirectory: importedDirectory,
      masterKey,
      now: at(startedAt, 5),
      packageDirectory: replication.packageDirectory,
    });
    phases.push({ id: "encrypted-replication", passed: true, summary: "Created, authenticated, decrypted, verified, and imported an encrypted recovery package without changing the live synthetic database." });

    const targetMigrationsDirectory = join(stagedApplication, "migrations");
    const upgrade = await validateContinuityUpgrade({
      backupDirectory: upgradeDirectory,
      databasePath,
      now: at(startedAt, 6),
      targetMigrationsDirectory,
    });
    if (upgrade.report.fromMigrationVersion !== baselineVersion) {
      throw new Error("Upgrade validation did not start from the baseline migration version.");
    }
    if (upgrade.report.toMigrationVersion <= baselineVersion) {
      throw new Error(
        "Release candidate migrations must advance beyond the baseline version.",
      );
    }
    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: targetMigrationsDirectory,
    });
    try {
      verifyContinuityDatabaseAcceptance({
        database: upgraded,
        migrationsDirectory: targetMigrationsDirectory,
        personaId,
        personas: new SqlitePersonaRepository(upgraded),
      });
      if (new SqliteMemoryRepository(upgraded).getById(memoryId) === null) {
        throw new Error("Synthetic memory was lost during live disposable upgrade.");
      }
    } finally {
      upgraded.close();
    }
    phases.push({ id: "upgrade-and-acceptance", passed: true, summary: `Validated on a snapshot, upgraded the disposable live database to schema ${upgrade.report.toMigrationVersion}, and passed acceptance.` });

    const restoreOptions = {
      databasePath,
      now: at(startedAt, 7),
      outputDirectory: upgradeDirectory,
      snapshotDirectory: upgrade.report.snapshotDirectory,
    };
    const restorePreview = previewGuidedRestore(restoreOptions);
    await applyGuidedRestore({
      ...restoreOptions,
      confirmation: restorePreview.confirmation,
    });
    if (migrationVersion(databasePath) !== baselineVersion) {
      throw new Error("Rollback did not restore the baseline migration version.");
    }
    const rolledBack = openMemTextualDatabase({ filename: databasePath, readonly: true });
    try {
      if (new SqliteMemoryRepository(rolledBack).getById(memoryId) === null) {
        throw new Error("Synthetic memory was lost during rollback.");
      }
    } finally {
      rolledBack.close();
    }
    phases.push({ id: "rollback", passed: true, summary: "Restored the retained pre-upgrade snapshot and verified the baseline schema and synthetic memory." });

    const removalPreview = await previewWindowsContinuityBundleRemoval({
      bundleDirectory: stagedApplication,
      trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
    });
    await applyWindowsContinuityBundleRemoval({
      bundleDirectory: stagedApplication,
      confirmation: removalPreview.confirmation,
      trustedCertificateFingerprint256: options.trustedCertificateFingerprint256,
    });
    if (!existsSync(databasePath) || existsSync(stagedApplication)) {
      throw new Error("Application removal did not preserve the synthetic database.");
    }
    phases.push({ id: "data-preserving-uninstall", passed: true, summary: "Removed only the staged signed application and preserved the external synthetic database and recovery artifacts." });

    const marker: ContinuityReleaseWorkspaceMarker = {
      candidateManifestSha256: staged.manifestSha256,
      candidatePublisherFingerprint256: staged.signingCertificateFingerprint256,
      formatVersion: continuityReleaseWorkspaceMarkerFormatVersion,
      syntheticDataOnly: true,
    };
    writeReport(
      join(workspaceDirectory, continuityReleaseWorkspaceMarkerFilename),
      marker,
    );
    const report: ContinuityReleaseValidationReport = {
      completedAt: new Date().toISOString(),
      formatVersion: continuityReleaseValidationFormatVersion,
      passed: true,
      phases,
      privilegedHostValidation: {
        reason: "Dedicated-account and Task Scheduler mutation requires a separate, explicitly approved elevated test on the target Windows host.",
        status: "not_run",
      },
      reportPath,
      startedAt: startedAt.toISOString(),
      syntheticDataOnly: true,
      workspaceDirectory,
    };
    writeReport(reportPath, report);
    return report;
  } catch (error) {
    writeReport(failurePath, {
      failedAt: new Date().toISOString(),
      formatVersion: continuityReleaseValidationFormatVersion,
      message: error instanceof Error ? error.message : "Unknown release validation failure",
      passed: false,
      passedPhases: phases,
      syntheticDataOnly: true,
      workspaceDirectory,
    });
    throw error;
  } finally {
    masterKey.fill(0);
  }
}
