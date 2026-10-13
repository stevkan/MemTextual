import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  IngestionService,
  LegacyMemoryMigrationService,
  openMemTextualDatabase,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const scope = memoryRepository.createScope({
    kind: "project",
    name: "Legacy migration test",
  });
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  return {
    database,
    ingestion,
    migration: new LegacyMemoryMigrationService(ingestion, memoryRepository),
    scope,
  };
}

test("legacy migration creates conservative review candidates and is idempotent", () => {
  const setup = fixture();
  try {
    const input = {
      formatVersion: 1 as const,
      source: {
        title: "Previous agent memories",
        originSystem: "Legacy Agent",
        externalId: "legacy-agent-export-2026-10-12",
        exportedAt: "2026-10-12T12:00:00Z",
        metadata: { exportVersion: 2 },
      },
      memories: [
        {
          id: "legacy-1",
          assertion: "  The user prefers TypeScript.  ",
          authorRole: "user",
          createdAt: "2026-01-02T03:04:05Z",
          metadata: { category: "preference" },
        },
        {
          id: "legacy-2",
          assertion: "The project uses SQLite.",
          type: "fact" as const,
          explicitness: "explicit" as const,
          confidence: 0.9,
          observedAt: "2026-02-03T04:05:06Z",
        },
      ],
    };

    const first = setup.migration.migrate(input, {
      defaultScopeId: setup.scope.id,
    });
    assert.equal(first.sourceCreated, true);
    assert.deepEqual(first.summary, {
      created: 2,
      reused: 0,
      pending: 2,
      accepted: 0,
      rejected: 0,
    });

    const firstCandidate = setup.ingestion.getCandidate(
      first.items[0]!.candidateId,
    );
    assert.equal(firstCandidate?.externalId, first.items[0]!.candidateExternalId);
    assert.equal(firstCandidate?.type, "other");
    assert.equal(firstCandidate?.explicitness, "inferred");
    assert.equal(firstCandidate?.confidence, 0.5);
    assert.equal(firstCandidate?.proposedBy, "import");
    assert.equal(firstCandidate?.metadata["requiresManualReview"], true);
    const firstRecord = setup.ingestion.getSourceRecord(
      firstCandidate!.evidence[0]!.sourceRecordId,
    );
    assert.equal(firstRecord?.content, "  The user prefers TypeScript.  ");
    assert.equal(
      (setup.database.prepare("SELECT count(*) AS count FROM memory_items").get() as {
        count: number;
      }).count,
      0,
    );

    const second = setup.migration.migrate(input, {
      defaultScopeId: setup.scope.id,
    });
    assert.equal(second.sourceCreated, false);
    assert.deepEqual(second.items.map(({ candidateId }) => candidateId),
      first.items.map(({ candidateId }) => candidateId));
    assert.equal(second.summary.created, 0);
    assert.equal(second.summary.reused, 2);

    const otherScope = new SqliteMemoryRepository(setup.database).createScope({
      kind: "project",
      name: "Different migration target",
    });
    assert.throws(
      () =>
        setup.migration.migrate(input, {
          defaultScopeId: otherScope.id,
        }),
      /already exists with different content/u,
    );

    const accepted = setup.ingestion.acceptCandidate(first.items[0]!.candidateId, {
      actor: "user",
      explicitUserAction: true,
      note: "Verified during legacy migration.",
    });
    assert.equal(accepted.memory.assertion, "The user prefers TypeScript.");
  } finally {
    setup.database.close();
  }
});

test("legacy migration validates stable identity and scope before importing", () => {
  const setup = fixture();
  try {
    assert.throws(
      () =>
        setup.migration.migrate({
          formatVersion: 1,
          source: {
            title: "Invalid export",
            originSystem: "Legacy Agent",
            externalId: "invalid-export",
          },
          memories: [
            { id: "duplicate", assertion: "One" },
            { id: "duplicate", assertion: "Two" },
          ],
        }),
      /Legacy memory IDs must be unique/u,
    );
    assert.equal(
      (setup.database.prepare("SELECT count(*) AS count FROM sources").get() as {
        count: number;
      }).count,
      0,
    );

    assert.throws(
      () =>
        setup.migration.migrate({
          formatVersion: 1,
          source: {
            title: "Missing scope",
            originSystem: "Legacy Agent",
            externalId: "missing-scope",
          },
          memories: [{ id: "legacy-1", assertion: "Needs a scope" }],
        }),
      /requires scopeId/u,
    );
    assert.equal(
      (setup.database.prepare("SELECT count(*) AS count FROM sources").get() as {
        count: number;
      }).count,
      0,
    );

    assert.throws(
      () =>
        setup.migration.migrate({
          formatVersion: 1,
          source: {
            title: "Unknown scope",
            originSystem: "Legacy Agent",
            externalId: "unknown-scope",
          },
          memories: [
            {
              id: "legacy-unknown-scope",
              assertion: "The scope must exist.",
              scopeId: "missing-scope-id",
            },
          ],
        }),
      /scopes do not exist: missing-scope-id/u,
    );
    assert.equal(
      (setup.database.prepare("SELECT count(*) AS count FROM sources").get() as {
        count: number;
      }).count,
      0,
    );
  } finally {
    setup.database.close();
  }
});

test("migration CLI imports an export without accepting its candidates", () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-legacy-cli-"));
  const databasePath = join(directory, "memtextual.db");
  const exportPath = join(directory, "legacy.json");
  const database = openMemTextualDatabase({
    filename: databasePath,
    migrationsDirectory: resolve("migrations"),
  });
  const scope = new SqliteMemoryRepository(database).createScope({
    kind: "project",
    name: "CLI migration",
  });
  database.close();
  writeFileSync(
    exportPath,
    JSON.stringify({
      formatVersion: 1,
      source: {
        title: "CLI legacy export",
        originSystem: "Legacy Agent",
        externalId: "cli-export",
      },
      memories: [{ id: "one", assertion: "Imported through the CLI." }],
    }),
  );

  try {
    const execution = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli/migrate.ts",
        "--file",
        exportPath,
        "--scope",
        scope.id,
        "--database",
        databasePath,
        "--migrations",
        resolve("migrations"),
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(execution.stdout) as {
      summary: { pending: number; accepted: number };
    };
    assert.equal(result.summary.pending, 1);
    assert.equal(result.summary.accepted, 0);

    const verification = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      assert.equal(
        (verification.prepare("SELECT count(*) AS count FROM memory_items").get() as {
          count: number;
        }).count,
        0,
      );
      assert.equal(
        (verification.prepare("SELECT count(*) AS count FROM memory_candidates").get() as {
          count: number;
        }).count,
        1,
      );
    } finally {
      verification.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
