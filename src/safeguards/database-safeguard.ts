import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const DERIVED_TABLES = new Set([
  "memory_embeddings",
  "memory_search_documents",
  "memory_search_fts",
  "memory_search_fts_config",
  "memory_search_fts_content",
  "memory_search_fts_data",
  "memory_search_fts_docsize",
  "memory_search_fts_idx",
  "schema_migrations",
]);

interface ColumnManifest {
  name: string;
  primaryKeyPosition: number;
}

interface TableManifest {
  columns: ColumnManifest[];
  contentSha256: string;
  rowCount: number;
}

interface MigrationManifest {
  appliedAt: string;
  name: string;
  version: number;
}

export interface DatabaseSafeguardManifest {
  backupFile: string;
  backupSha256: string;
  createdAt: string;
  formatVersion: 1;
  integrityCheck: string;
  migrations: MigrationManifest[];
  protectedTables: Record<string, TableManifest>;
  sourceDatabase: string;
  sourceDatabaseIdentity: string;
}

export interface SnapshotResult {
  backupPath: string;
  exportPath: string;
  manifest: DatabaseSafeguardManifest;
  manifestPath: string;
}

export interface VerificationResult {
  checkedTables: number;
  passed: boolean;
  problems: string[];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function hashFile(filename: string): string {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { type: "blob", base64: value.toString("base64") };
  }

  return value;
}

function columnsFor(database: Database.Database, table: string): ColumnManifest[] {
  return (database.pragma(`table_info(${quoteIdentifier(table)})`) as Array<{
    name: string;
    pk: number;
  }>).map(({ name, pk }) => ({ name, primaryKeyPosition: pk }));
}

function rowsFor(
  database: Database.Database,
  table: string,
  columns: ColumnManifest[],
): Array<Record<string, unknown>> {
  const names = columns.map(({ name }) => quoteIdentifier(name)).join(", ");
  const primaryKey = columns
    .filter(({ primaryKeyPosition }) => primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition);
  const orderColumns = primaryKey.length > 0 ? primaryKey : columns;
  const orderBy = orderColumns
    .map(({ name }) => `${quoteIdentifier(name)} COLLATE BINARY`)
    .join(", ");

  return database
    .prepare(`SELECT ${names} FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}`)
    .all() as Array<Record<string, unknown>>;
}

function canonicalRows(
  rows: Array<Record<string, unknown>>,
  columns: ColumnManifest[],
): string {
  return rows
    .map((row) =>
      JSON.stringify(columns.map(({ name }) => normalizeValue(row[name]))),
    )
    .join("\n");
}

function tableManifest(
  database: Database.Database,
  table: string,
  columns = columnsFor(database, table),
): { manifest: TableManifest; rows: Array<Record<string, unknown>> } {
  const rows = rowsFor(database, table, columns);
  const contentSha256 = createHash("sha256")
    .update(canonicalRows(rows, columns))
    .digest("hex");

  return {
    manifest: { columns, contentSha256, rowCount: rows.length },
    rows,
  };
}

function protectedTableNames(database: Database.Database): string[] {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;

  return rows
    .map(({ name }) => name)
    .filter((name) => !DERIVED_TABLES.has(name));
}

function readMigrations(database: Database.Database): MigrationManifest[] {
  const exists = database
    .prepare(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  if (exists === undefined) {
    return [];
  }

  return database
    .prepare(
      "SELECT version, name, applied_at AS appliedAt FROM schema_migrations ORDER BY version",
    )
    .all() as MigrationManifest[];
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(".", "-");
}

export function databaseSafeguardIdentity(databasePath: string): string {
  return createHash("sha256")
    .update(resolve(databasePath), "utf8")
    .digest("hex");
}

type SnapshotAccessKind = "directory" | "file";
type SnapshotAccessProbe = (path: string, kind: SnapshotAccessKind) => void;

function defaultSnapshotAccessProbe(
  path: string,
  kind: SnapshotAccessKind,
): void {
  if (kind === "directory") {
    accessSync(path, constants.R_OK | constants.W_OK);
    return;
  }
  const handle = openSync(path, "r+");
  closeSync(handle);
}

export function assertDatabaseSnapshotWriteAccess(
  databasePath: string,
  accessProbe: SnapshotAccessProbe = defaultSnapshotAccessProbe,
): void {
  const resolvedDatabase = resolve(databasePath);
  const checks = [
    {
      label: "database directory",
      kind: "directory" as const,
      path: dirname(resolvedDatabase),
    },
    {
      label: "database file",
      kind: "file" as const,
      path: resolvedDatabase,
    },
    ...[`${resolvedDatabase}-wal`, `${resolvedDatabase}-shm`]
      .filter((path) => existsSync(path))
      .map((path) => ({
        label: "SQLite WAL sidecar",
        kind: "file" as const,
        path,
      })),
  ];
  for (const check of checks) {
    try {
      accessProbe(check.path, check.kind);
    } catch (error) {
      throw new Error(
        `Database snapshot requires read and write access to the ${check.label}: ${check.path}. Run under the managed identity or an elevated account, or repair the recorded ACL before retrying.`,
        { cause: error },
      );
    }
  }
}

export async function createDatabaseSnapshot(options: {
  databasePath: string;
  outputDirectory: string;
  now?: Date;
}): Promise<SnapshotResult> {
  const databasePath = resolve(options.databasePath);
  const outputDirectory = resolve(options.outputDirectory);
  const createdAt = (options.now ?? new Date()).toISOString();
  const snapshotDirectory = join(
    outputDirectory,
    `memtextual-${timestampForFilename(new Date(createdAt))}`,
  );
  assertDatabaseSnapshotWriteAccess(databasePath);
  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(snapshotDirectory);

  const backupFile = "memtextual.db";
  const backupPath = join(snapshotDirectory, backupFile);
  const source = new Database(databasePath, { fileMustExist: true });
  source.pragma("busy_timeout = 5000");
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    backup.pragma("foreign_keys = ON");
    const integrity = backup.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    const integrityCheck = integrity.map((row) => row.integrity_check).join("; ");
    if (integrityCheck !== "ok") {
      throw new Error(`Snapshot integrity check failed: ${integrityCheck}`);
    }

    const protectedTables: Record<string, TableManifest> = {};
    const exportedTables: Record<string, Array<Record<string, unknown>>> = {};
    for (const table of protectedTableNames(backup)) {
      const result = tableManifest(backup, table);
      protectedTables[table] = result.manifest;
      exportedTables[table] = result.rows;
    }

    const manifest: DatabaseSafeguardManifest = {
      backupFile,
      backupSha256: hashFile(backupPath),
      createdAt,
      formatVersion: 1,
      integrityCheck,
      migrations: readMigrations(backup),
      protectedTables,
      sourceDatabase: basename(databasePath),
      sourceDatabaseIdentity: databaseSafeguardIdentity(databasePath),
    };
    const manifestPath = join(snapshotDirectory, "manifest.json");
    const exportPath = join(snapshotDirectory, "durable-data-export.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    writeFileSync(
      exportPath,
      `${JSON.stringify(
        { createdAt, formatVersion: 1, tables: exportedTables },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );

    return { backupPath, exportPath, manifest, manifestPath };
  } finally {
    backup.close();
  }
}

export function verifyDatabaseAgainstManifest(options: {
  databasePath: string;
  manifestPath: string;
}): VerificationResult {
  const manifest = JSON.parse(
    readFileSync(resolve(options.manifestPath), "utf8"),
  ) as DatabaseSafeguardManifest;
  if (manifest.formatVersion !== 1) {
    throw new Error(`Unsupported safeguard manifest version: ${manifest.formatVersion}`);
  }

  const database = new Database(resolve(options.databasePath), {
    readonly: true,
    fileMustExist: true,
  });
  const problems: string[] = [];
  try {
    database.pragma("foreign_keys = ON");
    const integrity = database.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    const integrityCheck = integrity.map((row) => row.integrity_check).join("; ");
    if (integrityCheck !== "ok") {
      problems.push(`Integrity check failed: ${integrityCheck}`);
    }

    for (const [table, expected] of Object.entries(manifest.protectedTables)) {
      const exists = database
        .prepare(
          "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
        )
        .get(table);
      if (exists === undefined) {
        problems.push(`Protected table is missing: ${table}`);
        continue;
      }

      const availableColumns = new Set(
        columnsFor(database, table).map(({ name }) => name),
      );
      const missingColumns = expected.columns
        .map(({ name }) => name)
        .filter((name) => !availableColumns.has(name));
      if (missingColumns.length > 0) {
        problems.push(
          `Protected columns are missing from ${table}: ${missingColumns.join(", ")}`,
        );
        continue;
      }

      const actual = tableManifest(database, table, expected.columns).manifest;
      if (actual.rowCount !== expected.rowCount) {
        problems.push(
          `${table} row count changed: expected ${expected.rowCount}, found ${actual.rowCount}`,
        );
      }
      if (actual.contentSha256 !== expected.contentSha256) {
        problems.push(`${table} content hash changed`);
      }
    }
  } finally {
    database.close();
  }

  return {
    checkedTables: Object.keys(manifest.protectedTables).length,
    passed: problems.length === 0,
    problems,
  };
}
