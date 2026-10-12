import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export interface OpenDatabaseOptions {
  filename: string;
  migrationsDirectory?: string;
  readonly?: boolean;
}

function hasMigrationTable(database: Database.Database): boolean {
  const row = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get() as { present: 1 } | undefined;

  return row !== undefined;
}

function appliedVersions(database: Database.Database): Set<number> {
  if (!hasMigrationTable(database)) {
    return new Set();
  }

  const rows = database
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;

  return new Set(rows.map(({ version }) => version));
}

export function applyMigrations(
  database: Database.Database,
  migrationsDirectory = resolve(process.cwd(), "migrations"),
): void {
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+.*\.sql$/u.test(filename))
    .sort();

  const applied = appliedVersions(database);

  for (const filename of migrationFiles) {
    const versionText = filename.match(/^(\d+)/u)?.[1];
    if (versionText === undefined) {
      continue;
    }

    const version = Number.parseInt(versionText, 10);
    if (applied.has(version)) {
      continue;
    }

    const sql = readFileSync(resolve(migrationsDirectory, filename), "utf8");
    database.exec(sql);
    applied.add(version);
  }
}

export function openMemTextualDatabase(
  options: OpenDatabaseOptions,
): Database.Database {
  const database = new Database(options.filename, {
    readonly: options.readonly ?? false,
    fileMustExist: options.readonly ?? false,
  });

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  if (options.filename !== ":memory:" && !(options.readonly ?? false)) {
    database.pragma("journal_mode = WAL");
  }

  if (!(options.readonly ?? false)) {
    applyMigrations(database, options.migrationsDirectory);
  }

  return database;
}
