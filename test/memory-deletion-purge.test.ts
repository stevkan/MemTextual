import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ExplicitUserActionRequiredError,
  IngestionService,
  MemoryService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  database.exec(readFileSync(resolve("examples", "seed-v0.1.sql"), "utf8"));
  const memoryRepository = new SqliteMemoryRepository(database);
  return {
    database,
    memoryRepository,
    memoryService: new MemoryService(memoryRepository),
    ingestionService: new IngestionService(
      new SqliteIngestionRepository(database, memoryRepository),
    ),
  };
}

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("memory deletion is explicit, reversible, and removes retrieval data", () => {
  const { database, memoryRepository, memoryService } = fixture();
  try {
    assert.throws(
      () => memoryService.delete("memory_03", { reason: "User requested forgetting." }),
      ExplicitUserActionRequiredError,
    );
    assert.throws(
      () =>
        memoryRepository.delete(
          "memory_03",
          { reason: "Untrusted direct call." },
          "system",
          true,
        ),
      /explicit user action/u,
    );

    const deleted = memoryService.delete(
      "memory_03",
      { reason: "User requested forgetting." },
      explicitUserAction,
    );
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.deletionReason, "User requested forgetting.");
    assert.ok(deleted.deletedAt !== null);
    assert.deepEqual(
      memoryService.retrieve({ text: "SQLite", scopeIds: ["scope_memtextual"] }),
      [],
    );
    assert.equal(
      (
        database
          .prepare("SELECT count(*) AS count FROM memory_search_documents WHERE memory_id = ?")
          .get("memory_03") as { count: number }
      ).count,
      0,
    );

    const restored = memoryService.restoreDeleted("memory_03", explicitUserAction);
    assert.equal(restored.status, "active");
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.deletionReason, null);
    assert.equal(
      memoryService.retrieve({ text: "SQLite", scopeIds: ["scope_memtextual"] })[0]
        ?.memory.id,
      "memory_03",
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM memory_deletion_events WHERE memory_id = ? AND restored_at IS NOT NULL",
          )
          .get("memory_03") as { count: number }
      ).count,
      1,
    );

    memoryService.archive("memory_03", { actor: "user" });
    memoryService.delete(
      "memory_03",
      { reason: "Test archived recovery." },
      explicitUserAction,
    );
    assert.equal(
      memoryService.restoreDeleted("memory_03", explicitUserAction).status,
      "archived",
    );
  } finally {
    database.close();
  }
});

test("memory purge requires tombstone and exact confirmation, then removes active database content", () => {
  const { database, memoryService } = fixture();
  try {
    const before = memoryService.previewPurge("memory_03");
    assert.equal(before.canPurge, false);
    assert.deepEqual(before.retainedSourceRecordIds, ["record_03"]);
    assert.throws(
      () =>
        memoryService.purge(
          "memory_03",
          { reason: "Privacy request.", confirmation: "wrong-id" },
          explicitUserAction,
        ),
      /exactly match/u,
    );

    memoryService.delete("memory_03", { reason: "Prepare for purge." }, explicitUserAction);
    const preview = memoryService.previewPurge("memory_03");
    assert.equal(preview.canPurge, true);
    assert.equal(preview.externalCopiesNotModified, true);

    const receipt = memoryService.purge(
      "memory_03",
      { reason: "Privacy request.", confirmation: "memory_03" },
      explicitUserAction,
    );
    assert.equal(receipt.memoryId, "memory_03");
    assert.equal(receipt.retainedSourceRecordCount, 1);
    assert.equal(receipt.externalCopiesNotModified, true);
    assert.equal(memoryService.getById("memory_03"), null);
    assert.equal(database.prepare("SELECT content FROM source_records WHERE id = ?").get("record_03") !== undefined, true);
    assert.equal(
      (
        database
          .prepare("SELECT count(*) AS count FROM privacy_purge_receipts WHERE id = ?")
          .get(receipt.receiptId) as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        database
          .prepare("SELECT count(*) AS count FROM audit_events WHERE memory_id = ?")
          .get("memory_03") as { count: number }
      ).count,
      0,
    );
    assert.ok((receipt.deletedRowCounts.auditEvents ?? 0) > 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("purging an accepted memory also removes candidate lineage that would retain its assertion", () => {
  const { database, ingestionService, memoryService } = fixture();
  try {
    const imported = ingestionService.importSource({
      kind: "manual",
      title: "Private statement",
      externalId: "private:purge-test",
      records: [{ kind: "entry", authorRole: "user", content: "Private assertion." }],
    });
    const candidate = ingestionService.proposeCandidate({
      assertion: "Private assertion.",
      type: "fact",
      scopeId: "scope_memtextual",
      evidence: [{ sourceRecordId: imported.records[0]!.id }],
      proposedBy: "user",
    });
    const accepted = ingestionService.acceptCandidate(candidate.id, {
      actor: "user",
      explicitUserAction: true,
    });

    memoryService.delete(accepted.memory.id, { reason: "Prepare." }, explicitUserAction);
    const preview = memoryService.previewPurge(accepted.memory.id);
    assert.equal(preview.candidateCount, 1);
    memoryService.purge(
      accepted.memory.id,
      { reason: "Remove memory lineage.", confirmation: accepted.memory.id },
      explicitUserAction,
    );

    assert.equal(ingestionService.getCandidate(candidate.id), null);
    assert.equal(database.prepare("SELECT content FROM source_records WHERE id = ?").get(imported.records[0]!.id) !== undefined, true);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("privacy CLI requires exact confirmation before changing a memory", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-privacy-"));
  const databasePath = join(temporaryDirectory, "privacy.db");
  const database = openMemTextualDatabase({
    filename: databasePath,
    migrationsDirectory: resolve("migrations"),
  });
  const service = new MemoryService(new SqliteMemoryRepository(database));
  const scope = service.createScope({ kind: "project", name: "Privacy CLI" });
  const memory = service.create({
    assertion: "CLI deletion fixture.",
    type: "fact",
    scopeId: scope.id,
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
      "delete",
      "--id",
      memory.id,
      "--reason",
      "CLI test.",
      "--confirm",
      "wrong-id",
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /exactly match/u);

    const deleted = run(
      "delete",
      "--id",
      memory.id,
      "--reason",
      "CLI test.",
      "--confirm",
      memory.id,
    );
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.match(deleted.stdout, /"status": "deleted"/u);

    const restored = run(
      "restore",
      "--id",
      memory.id,
      "--confirm",
      memory.id,
    );
    assert.equal(restored.status, 0, restored.stderr);
    assert.match(restored.stdout, /"status": "active"/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
