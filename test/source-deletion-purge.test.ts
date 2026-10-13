import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ExplicitSourceMutationRequiredError,
  IngestionService,
  MemoryService,
  ReviewAutomationService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqliteReviewPolicyRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const ingestionRepository = new SqliteIngestionRepository(
    database,
    memoryRepository,
  );
  const policyRepository = new SqliteReviewPolicyRepository(
    database,
    ingestionRepository,
  );
  return {
    database,
    ingestionRepository,
    ingestionService: new IngestionService(ingestionRepository),
    memoryService: new MemoryService(memoryRepository),
    automation: new ReviewAutomationService(ingestionRepository, policyRepository),
    scope: memoryRepository.createScope({ kind: "project", name: "Source privacy" }),
  };
}

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("source-series deletion is explicit, reversible, and preserves prior record tombstones", () => {
  const setup = fixture();
  try {
    const first = setup.ingestionService.importSource({
      kind: "file",
      title: "Versioned source",
      externalId: "file:source-delete",
      records: [
        { kind: "section", content: "Keep hidden before deletion." },
        { kind: "section", content: "Version one visible." },
      ],
    });
    setup.database
      .prepare(
        "UPDATE source_records SET deleted_at = '2026-10-12T00:00:00.000Z' WHERE id = ?",
      )
      .run(first.records[0]!.id);
    setup.ingestionService.importSource({
      kind: "file",
      title: "Versioned source",
      externalId: "file:source-delete",
      createVersion: true,
      records: [{ kind: "section", content: "Version two visible." }],
    });

    assert.throws(
      () =>
        setup.ingestionService.deleteSourceSeries({
          kind: "file",
          externalId: "file:source-delete",
          reason: "User requested deletion.",
        }),
      ExplicitSourceMutationRequiredError,
    );
    assert.throws(
      () =>
        setup.ingestionRepository.deleteSourceSeries(
          {
            kind: "file",
            externalId: "file:source-delete",
            reason: "Untrusted direct call.",
          },
          "system",
          true,
        ),
      /explicit user action/u,
    );

    const deleted = setup.ingestionService.deleteSourceSeries(
      {
        kind: "file",
        externalId: "file:source-delete",
        reason: "User requested deletion.",
      },
      explicitUserAction,
    );
    assert.equal(deleted.length, 2);
    assert.ok(deleted.every(({ deletedAt }) => deletedAt !== null));
    assert.ok(deleted.every(({ deletionReason }) => deletionReason === "User requested deletion."));
    assert.deepEqual(setup.ingestionService.listSources(), []);
    assert.deepEqual(setup.ingestionService.getSourceRecords(deleted[1]!.id), []);
    assert.throws(
      () =>
        setup.ingestionService.importSource({
          kind: "file",
          title: "Versioned source",
          externalId: "file:source-delete",
          records: [{ kind: "section", content: "Version two visible." }],
        }),
      /Restore the source series/u,
    );

    const restored = setup.ingestionService.restoreSourceSeries(
      { kind: "file", externalId: "file:source-delete" },
      explicitUserAction,
    );
    assert.ok(restored.every(({ deletedAt }) => deletedAt === null));
    assert.equal(setup.ingestionService.listSources()[0]?.versionNumber, 2);
    assert.equal(setup.ingestionService.getSourceRecords(restored[0]!.id).length, 1);
    assert.equal(
      (
        setup.database
          .prepare("SELECT deleted_at FROM source_records WHERE id = ?")
          .get(first.records[0]!.id) as { deleted_at: string | null }
      ).deleted_at,
      "2026-10-12T00:00:00.000Z",
    );
  } finally {
    setup.database.close();
  }
});

test("source purge is blocked by dependent memories and removes candidate lineage after they are gone", () => {
  const setup = fixture();
  try {
    const imported = setup.ingestionService.importSource({
      kind: "manual",
      title: "Privacy source",
      externalId: "manual:privacy-source",
      records: [{ kind: "entry", authorRole: "user", content: "Private source fact." }],
    });
    const candidate = setup.ingestionService.proposeCandidate({
      assertion: "Private source fact.",
      type: "fact",
      scopeId: setup.scope.id,
      evidence: [{ sourceRecordId: imported.records[0]!.id }],
      proposedBy: "user",
    });
    const accepted = setup.ingestionService.acceptCandidate(candidate.id, explicitUserAction);
    const pending = setup.ingestionService.proposeCandidate({
      assertion: "A pending interpretation of the private source.",
      type: "fact",
      scopeId: setup.scope.id,
      evidence: [{ sourceRecordId: imported.records[0]!.id }],
      proposedBy: "system",
    });
    setup.ingestionService.deleteSourceSeries(
      {
        kind: "manual",
        externalId: "manual:privacy-source",
        reason: "Prepare source purge.",
      },
      explicitUserAction,
    );

    const blocked = setup.ingestionService.previewSourceSeriesPurge({
      kind: "manual",
      externalId: "manual:privacy-source",
    });
    assert.equal(blocked.canPurge, false);
    assert.deepEqual(blocked.dependentMemoryIds, [accepted.memory.id]);
    assert.deepEqual(blocked.dependentCandidateIds.sort(), [candidate.id, pending.id].sort());

    setup.memoryService.delete(
      accepted.memory.id,
      { reason: "Remove dependent memory." },
      explicitUserAction,
    );
    setup.memoryService.purge(
      accepted.memory.id,
      { reason: "Remove dependency.", confirmation: accepted.memory.id },
      explicitUserAction,
    );
    const ready = setup.ingestionService.previewSourceSeriesPurge({
      kind: "manual",
      externalId: "manual:privacy-source",
    });
    assert.equal(ready.canPurge, true);
    assert.deepEqual(ready.dependentMemoryIds, []);
    assert.deepEqual(ready.dependentCandidateIds, [pending.id]);

    assert.throws(
      () =>
        setup.ingestionService.purgeSourceSeries(
          {
            kind: "manual",
            externalId: "manual:privacy-source",
            reason: "Permanent source removal.",
            confirmation: "wrong-id",
          },
          explicitUserAction,
        ),
      /exactly match/u,
    );
    const receipt = setup.ingestionService.purgeSourceSeries(
      {
        kind: "manual",
        externalId: "manual:privacy-source",
        reason: "Permanent source removal.",
        confirmation: "manual:privacy-source",
      },
      explicitUserAction,
    );
    assert.equal(receipt.externalCopiesNotModified, true);
    assert.equal(receipt.deletedRowCounts.sourceRecords, 1);
    assert.equal(receipt.deletedRowCounts.sourceDeletionEvents, 1);
    assert.equal(receipt.deletedRowCounts.sourceDeletionSources, 1);
    assert.equal(receipt.deletedRowCounts.sourceDeletionRecords, 1);
    assert.equal(setup.ingestionService.getCandidate(pending.id), null);
    assert.equal(
      setup.database.prepare("SELECT 1 FROM sources WHERE id = ?").get(imported.source.id),
      undefined,
    );
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM source_purge_receipts WHERE id = ?")
          .get(receipt.receiptId) as { count: number }
      ).count,
      1,
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("active trusted-source policies block source purge until replaced", () => {
  const setup = fixture();
  try {
    setup.ingestionService.importSource({
      kind: "chat",
      title: "Trusted chat",
      externalId: "chat:trusted-source",
      records: [{ kind: "message", authorRole: "user", content: "Trusted text." }],
    });
    const policy = setup.automation.setPolicy(
      {
        name: "Trusted source policy",
        mode: "automatic_explicit",
        conditions: {
          trustedSources: [{ kind: "chat", externalId: "chat:trusted-source" }],
        },
      },
      explicitUserAction,
    );
    setup.ingestionService.deleteSourceSeries(
      {
        kind: "chat",
        externalId: "chat:trusted-source",
        reason: "Prepare policy test.",
      },
      explicitUserAction,
    );

    const blocked = setup.ingestionService.previewSourceSeriesPurge({
      kind: "chat",
      externalId: "chat:trusted-source",
    });
    assert.deepEqual(blocked.activeReviewPolicyIds, [policy.id]);
    assert.equal(blocked.canPurge, false);

    setup.automation.setPolicy(
      { name: "Manual replacement", mode: "manual" },
      explicitUserAction,
    );
    const ready = setup.ingestionService.previewSourceSeriesPurge({
      kind: "chat",
      externalId: "chat:trusted-source",
    });
    assert.deepEqual(ready.activeReviewPolicyIds, []);
    assert.equal(ready.canPurge, true);
  } finally {
    setup.database.close();
  }
});

test("privacy CLI requires exact source identity confirmation", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-source-privacy-"));
  const databasePath = join(temporaryDirectory, "privacy.db");
  const database = openMemTextualDatabase({
    filename: databasePath,
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  ingestion.importSource({
    kind: "file",
    title: "CLI source",
    externalId: "file:cli-source",
    records: [{ kind: "section", content: "CLI source content." }],
  });
  database.close();

  const run = (...arguments_: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "privacy.ts"),
        ...arguments_,
        "--database",
        databasePath,
        "--migrations",
        resolve("migrations"),
      ],
      { encoding: "utf8" },
    );

  try {
    const rejected = run(
      "source-delete",
      "--kind",
      "file",
      "--external-id",
      "file:cli-source",
      "--reason",
      "CLI test.",
      "--confirm",
      "wrong-id",
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /exactly match/u);

    const deleted = run(
      "source-delete",
      "--kind",
      "file",
      "--external-id",
      "file:cli-source",
      "--reason",
      "CLI test.",
      "--confirm",
      "file:cli-source",
    );
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.match(deleted.stdout, /"deletedAt":/u);

    const restored = run(
      "source-restore",
      "--kind",
      "file",
      "--external-id",
      "file:cli-source",
      "--confirm",
      "file:cli-source",
    );
    assert.equal(restored.status, 0, restored.stderr);
    assert.match(restored.stdout, /"deletedAt": null/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
