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

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const repository = new SqliteIngestionRepository(database, memoryRepository);
  const service = new IngestionService(repository);
  const scope = memoryRepository.createScope({
    kind: "project",
    name: "Candidate resolution",
    externalKey: "candidate-resolution",
  });
  const imported = service.importSource({
    kind: "chat",
    title: "Resolution evidence",
    externalId: "candidate-resolution:evidence",
    records: [
      { kind: "message", authorRole: "user", content: "Updated evidence." },
    ],
  });
  return { database, imported, memoryRepository, repository, scope, service };
}

function explicitUser(note?: string) {
  return {
    actor: "user" as const,
    explicitUserAction: true,
    ...(note === undefined ? {} : { note }),
  };
}

test("exact normalized matches are suggested and can reaffirm an existing memory", () => {
  const setup = fixture();
  try {
    const existing = setup.memoryRepository.create({
      assertion: "MemTextual is local-first.",
      normalizedAssertion: "deployment local first",
      type: "decision",
      scopeId: setup.scope.id,
      isProtected: true,
    });
    const candidate = setup.service.proposeCandidate({
      assertion: "MemTextual remains local first!",
      normalizedAssertion: "Deployment: local-first",
      type: "decision",
      scopeId: setup.scope.id,
      evidence: [{ sourceRecordId: setup.imported.records[0]!.id }],
    });

    const matches = setup.service.findCandidateMatches(candidate.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.memory.id, existing.id);
    assert.equal(matches[0]?.matchKind, "exact_normalized");

    assert.throws(
      () =>
        setup.service.resolveCandidate(candidate.id, {
          outcome: "reaffirm",
          targetMemoryId: existing.id,
        }),
      ExplicitCandidateReviewRequiredError,
    );
    const result = setup.service.resolveCandidate(
      candidate.id,
      { outcome: "reaffirm", targetMemoryId: existing.id },
      explicitUser("Confirmed again."),
    );

    assert.equal(result.resolution.outcome, "reaffirm");
    assert.equal(result.memory?.id, existing.id);
    assert.equal(result.memory?.revisionNumber, 2);
    assert.equal(result.memory?.assertion, existing.assertion);
    assert.equal(setup.memoryRepository.getHistory(existing.id)[1]?.changeKind, "reaffirmed");
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM memory_evidence WHERE memory_revision_id = ?")
          .get(result.memory!.revisionId) as { count: number }
      ).count,
      1,
    );
  } finally {
    setup.database.close();
  }
});

test("revise resolves into the existing memory and preserves candidate evidence", () => {
  const setup = fixture();
  try {
    const existing = setup.memoryRepository.create({
      assertion: "Use SQLite.",
      type: "decision",
      scopeId: setup.scope.id,
      isProtected: true,
    });
    const candidate = setup.service.proposeCandidate({
      assertion: "Use SQLite with WAL journaling.",
      type: "decision",
      scopeId: setup.scope.id,
      evidence: [{ sourceRecordId: setup.imported.records[0]!.id }],
    });

    const result = setup.service.resolveCandidate(
      candidate.id,
      { outcome: "revise", targetMemoryId: existing.id },
      explicitUser(),
    );

    assert.equal(result.memory?.id, existing.id);
    assert.equal(result.memory?.assertion, candidate.assertion);
    assert.equal(result.memory?.revisionNumber, 2);
    assert.equal(setup.memoryRepository.getHistory(existing.id)[1]?.changeKind, "corrected");
    assert.equal(
      (
        setup.database.prepare("SELECT count(*) AS count FROM memory_items").get() as {
          count: number;
        }
      ).count,
      1,
    );
  } finally {
    setup.database.close();
  }
});

for (const outcome of ["contradict", "supersede"] as const) {
  test(`${outcome} creates a linked replacement and transitions the target`, () => {
    const setup = fixture();
    try {
      const existing = setup.memoryRepository.create({
        assertion: "The earlier assertion.",
        type: "fact",
        scopeId: setup.scope.id,
      });
      const candidate = setup.service.proposeCandidate({
        assertion: `The ${outcome}ing assertion.`,
        type: "fact",
        scopeId: setup.scope.id,
        evidence: [{ sourceRecordId: setup.imported.records[0]!.id }],
      });

      const result = setup.service.resolveCandidate(
        candidate.id,
        { outcome, targetMemoryId: existing.id },
        explicitUser(),
      );

      assert.notEqual(result.memory?.id, existing.id);
      assert.equal(result.memory?.status, "active");
      assert.equal(
        result.targetMemory?.status,
        outcome === "contradict" ? "contradicted" : "superseded",
      );
      assert.equal(result.resolution.targetMemoryId, existing.id);
      assert.equal(result.resolution.resultMemoryId, result.memory?.id);
      const relation = setup.database
        .prepare(
          "SELECT relation_type FROM memory_relations WHERE from_memory_id = ? AND to_memory_id = ?",
        )
        .get(result.memory!.id, existing.id) as { relation_type: string };
      assert.equal(relation.relation_type, `${outcome}s`);
    } finally {
      setup.database.close();
    }
  });
}

test("invalid resolution targets roll back without reviewing the candidate", () => {
  const setup = fixture();
  try {
    const otherScope = setup.memoryRepository.createScope({
      kind: "project",
      name: "Other scope",
      externalKey: "candidate-resolution:other",
    });
    const existing = setup.memoryRepository.create({
      assertion: "Other scoped memory.",
      type: "fact",
      scopeId: otherScope.id,
    });
    const candidate = setup.service.proposeCandidate({
      assertion: "Candidate assertion.",
      type: "fact",
      scopeId: setup.scope.id,
      evidence: [{ sourceRecordId: setup.imported.records[0]!.id }],
    });

    assert.throws(
      () =>
        setup.service.resolveCandidate(
          candidate.id,
          { outcome: "revise", targetMemoryId: existing.id },
          explicitUser(),
        ),
      /share the candidate scope/u,
    );
    assert.equal(setup.service.getCandidate(candidate.id)?.status, "pending");
    assert.equal(setup.repository.getCandidateResolution(candidate.id), null);
    assert.equal(setup.memoryRepository.getHistory(existing.id).length, 1);
  } finally {
    setup.database.close();
  }
});
