import type Database from "better-sqlite3";
import { lstatSync, readdirSync } from "node:fs";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import type { WindowsHostInstallationPreview } from "../platform/windows-host-integration.js";

export interface ContinuityDatabaseAcceptance {
  databaseIntegrity: "ok";
  foreignKeyViolations: 0;
  migrationCount: number;
  persona: {
    id: string;
    name: string;
    relationshipId: string;
    userId: string;
  };
}

export interface ContinuityHostAcceptance {
  identityName: string;
  scheduleIds: readonly string[];
}

function expectedMigrationVersions(migrationsDirectory: string): number[] {
  let stats;
  try {
    stats = lstatSync(migrationsDirectory);
  } catch {
    throw new Error("Continuity migrations directory does not exist.");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Continuity migrations path must be a direct directory.");
  }
  const versions = readdirSync(migrationsDirectory)
    .map((filename) => filename.match(/^(\d+).*\.sql$/u)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => Number.parseInt(value, 10))
    .sort((left, right) => left - right);
  if (versions.length === 0 || new Set(versions).size !== versions.length) {
    throw new Error(
      "Continuity migrations directory must contain uniquely versioned SQL migrations.",
    );
  }
  return versions;
}

export function verifyContinuityDatabaseAcceptance(options: {
  database: Database.Database;
  migrationsDirectory: string;
  personaId: string;
  personas: PersonaRepository;
}): ContinuityDatabaseAcceptance {
  const integrity = options.database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  const integrityMessage = integrity.map((row) => row.integrity_check).join("; ");
  if (integrityMessage !== "ok") {
    throw new Error(`Continuity database integrity check failed: ${integrityMessage}`);
  }
  const foreignKeys = options.database.pragma("foreign_key_check") as unknown[];
  if (foreignKeys.length > 0) {
    throw new Error(
      `Continuity database has ${foreignKeys.length} foreign-key violation(s).`,
    );
  }

  const expectedVersions = expectedMigrationVersions(options.migrationsDirectory);
  const appliedVersions = (
    options.database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>
  ).map(({ version }) => version);
  if (
    appliedVersions.length !== expectedVersions.length ||
    appliedVersions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error(
      `Continuity database migrations do not match the installed application (applied ${appliedVersions.length}, expected ${expectedVersions.length}).`,
    );
  }

  const context = options.personas.getPersonaContext(options.personaId);
  if (context === null) {
    throw new Error(`Continuity persona not found: ${options.personaId}`);
  }
  return {
    databaseIntegrity: "ok",
    foreignKeyViolations: 0,
    migrationCount: appliedVersions.length,
    persona: {
      id: context.persona.id,
      name: context.persona.name,
      relationshipId: context.relationship.id,
      userId: context.persona.userId,
    },
  };
}

export function verifyContinuityHostAcceptance(
  preview: WindowsHostInstallationPreview,
): ContinuityHostAcceptance {
  if (
    preview.identityWillBeProvisioned ||
    preview.schedulesWillBeInstalled.length > 0
  ) {
    throw new Error(
      "Continuity host installation is incomplete; run install-preview and explicitly apply its current plan before acceptance.",
    );
  }
  if (!preview.currentIdentity.available || !preview.currentIdentity.managedByMemTextual) {
    throw new Error("Continuity host identity is not installed and managed by MemTextual.");
  }
  const incompleteSchedule = preview.currentSchedules.find(
    (schedule) => !schedule.installed || !schedule.managedByMemTextual,
  );
  if (incompleteSchedule !== undefined) {
    throw new Error(
      `Continuity host schedule is not installed and managed by MemTextual: ${incompleteSchedule.scheduleId}.`,
    );
  }
  return {
    identityName: preview.currentIdentity.identityName,
    scheduleIds: preview.currentSchedules.map(({ scheduleId }) => scheduleId),
  };
}
