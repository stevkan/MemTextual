import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ExplicitCandidateReviewRequiredError,
  IngestionService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function ingestionFixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const service = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const scope = memoryRepository.createScope({
    kind: "project",
    name: "Ingestion tests",
    externalKey: "project:ingestion-tests",
  });
  return { database, memoryRepository, scope, service };
}

test("source imports are atomic and idempotent", () => {
  const { database, service } = ingestionFixture();

  try {
    const input = {
      kind: "chat" as const,
      title: "Architecture conversation",
      externalId: "chat:architecture:1",
      metadata: { second: 2, first: 1 },
      records: [
        {
          kind: "message" as const,
          authorRole: "user",
          content: "Use TypeScript for MemTextual.",
        },
        {
          kind: "message" as const,
          authorRole: "assistant",
          content: "TypeScript is selected.",
        },
      ],
    };

    const first = service.importSource(input);
    const repeated = service.importSource({
      ...input,
      metadata: { first: 1, second: 2 },
    });

    assert.equal(first.created, true);
    assert.equal(repeated.created, false);
    assert.equal(repeated.source.id, first.source.id);
    assert.equal(repeated.records.length, 2);
    assert.deepEqual(repeated.records.map(({ ordinal }) => ordinal), [0, 1]);

    assert.throws(
      () =>
        service.importSource({
          ...input,
          records: [{ kind: "message", content: "Changed content." }],
        }),
      /different content/u,
    );

    const counts = database
      .prepare(
        `SELECT
           (SELECT count(*) FROM sources) AS sources,
           (SELECT count(*) FROM source_records) AS records`,
      )
      .get() as { sources: number; records: number };
    assert.deepEqual(counts, { sources: 1, records: 2 });
  } finally {
    database.close();
  }
});

test("candidate acceptance requires explicit user review and preserves evidence", () => {
  const { database, memoryRepository, scope, service } = ingestionFixture();

  try {
    const imported = service.importSource({
      kind: "file",
      title: "Design notes",
      externalId: "file:design-notes:v1",
      records: [
        { kind: "section", content: "MemTextual is local-first." },
        { kind: "section", content: "MemTextual uses SQLite." },
      ],
    });
    const candidate = service.proposeCandidate({
      assertion: "MemTextual is a local-first SQLite application.",
      normalizedAssertion: "deployment: local-first; database: SQLite",
      type: "decision",
      scopeId: scope.id,
      evidence: imported.records.map(({ id, content }) => ({
        sourceRecordId: id,
        role: "supports" as const,
        excerpt: content,
      })),
      proposedBy: "extractor",
      isProtected: true,
    });

    assert.equal(candidate.status, "pending");
    assert.equal(candidate.evidence.length, 2);
    assert.throws(
      () => service.acceptCandidate(candidate.id),
      ExplicitCandidateReviewRequiredError,
    );

    const accepted = service.acceptCandidate(candidate.id, {
      actor: "user",
      explicitUserAction: true,
      note: "Verified against both design sections.",
    });

    assert.equal(accepted.candidate.status, "accepted");
    assert.equal(accepted.candidate.acceptedMemoryId, accepted.memory.id);
    assert.equal(accepted.memory.isProtected, true);
    assert.equal(accepted.memory.scopes[0]?.id, scope.id);
    assert.equal(
      database
        .prepare("SELECT outcome FROM candidate_resolutions WHERE candidate_id = ?")
        .get(candidate.id) !== undefined,
      true,
    );
    assert.equal(memoryRepository.getById(accepted.memory.id)?.id, accepted.memory.id);

    const evidenceCount = database
      .prepare(
        "SELECT count(*) AS count FROM memory_evidence WHERE memory_revision_id = ?",
      )
      .get(accepted.memory.revisionId) as { count: number };
    assert.equal(evidenceCount.count, 2);

    assert.throws(
      () =>
        service.acceptCandidate(candidate.id, {
          actor: "user",
          explicitUserAction: true,
        }),
      /status is accepted/u,
    );
    const memoryCount = database
      .prepare("SELECT count(*) AS count FROM memory_items")
      .get() as { count: number };
    assert.equal(memoryCount.count, 1);
  } finally {
    database.close();
  }
});

test("candidate rejection preserves the proposal and review audit", () => {
  const { database, scope, service } = ingestionFixture();

  try {
    const imported = service.importSource({
      kind: "manual",
      title: "Unverified note",
      records: [{ kind: "entry", content: "Maybe use a hosted database." }],
    });
    const candidate = service.proposeCandidate({
      assertion: "MemTextual should use a hosted database.",
      type: "decision",
      scopeId: scope.id,
      evidence: [{ sourceRecordId: imported.records[0]!.id }],
    });
    const rejected = service.rejectCandidate(candidate.id, {
      actor: "user",
      explicitUserAction: true,
      note: "Conflicts with the local-first requirement.",
    });

    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.acceptedMemoryId, null);
    assert.equal(
      (
        database
          .prepare("SELECT outcome FROM candidate_resolutions WHERE candidate_id = ?")
          .get(candidate.id) as { outcome: string }
      ).outcome,
      "ignore",
    );
    assert.match(rejected.reviewNote ?? "", /local-first/u);
    assert.equal(service.listCandidates("pending").length, 0);
    assert.equal(service.listCandidates("rejected")[0]?.id, candidate.id);

    const events = database
      .prepare(
        "SELECT event_type FROM candidate_events WHERE candidate_id = ? ORDER BY occurred_at, rowid",
      )
      .all(candidate.id) as Array<{ event_type: string }>;
    assert.deepEqual(events.map(({ event_type }) => event_type), ["proposed", "rejected"]);
  } finally {
    database.close();
  }
});
