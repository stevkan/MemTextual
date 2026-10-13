import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
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
  const service = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  return { database, service };
}

test("changed external sources require an explicit version and retain history", () => {
  const { database, service } = fixture();
  try {
    const first = service.importSource({
      kind: "file",
      title: "Continuity design",
      externalId: "docs/continuity-design.md",
      records: [{ kind: "section", content: "Initial design." }],
    });
    assert.equal(first.source.versionNumber, 1);
    assert.equal(first.source.previousSourceId, null);
    assert.equal(first.source.isCurrent, true);
    assert.notEqual(first.source.seriesId, null);

    assert.throws(
      () =>
        service.importSource({
          kind: "file",
          title: "Continuity design",
          externalId: "docs/continuity-design.md",
          records: [{ kind: "section", content: "Updated design." }],
        }),
      /Set createVersion to true/u,
    );

    const second = service.importSource({
      kind: "file",
      title: "Continuity design",
      externalId: "docs/continuity-design.md",
      createVersion: true,
      versionReason: "Added source retention requirements.",
      records: [{ kind: "section", content: "Updated design." }],
    });
    assert.equal(second.created, true);
    assert.equal(second.source.externalId, "docs/continuity-design.md");
    assert.equal(second.source.versionNumber, 2);
    assert.equal(second.source.previousSourceId, first.source.id);
    assert.equal(second.source.seriesId, first.source.seriesId);
    assert.equal(second.source.isCurrent, true);

    const repeated = service.importSource({
      kind: "file",
      title: "Continuity design renamed in envelope only",
      externalId: "docs/continuity-design.md",
      createVersion: true,
      records: [{ kind: "section", content: "Updated design." }],
    });
    assert.equal(repeated.created, false);
    assert.equal(repeated.source.id, second.source.id);

    const history = service.getSourceHistory("file", "docs/continuity-design.md");
    assert.deepEqual(
      history.map(({ id, versionNumber, previousSourceId, versionReason, isCurrent }) => ({
        id,
        versionNumber,
        previousSourceId,
        versionReason,
        isCurrent,
      })),
      [
        {
          id: first.source.id,
          versionNumber: 1,
          previousSourceId: null,
          versionReason: null,
          isCurrent: false,
        },
        {
          id: second.source.id,
          versionNumber: 2,
          previousSourceId: first.source.id,
          versionReason: "Added source retention requirements.",
          isCurrent: true,
        },
      ],
    );
    assert.equal(service.getSourceRecords(first.source.id)[0]?.content, "Initial design.");
    assert.equal(service.getSourceRecords(second.source.id)[0]?.content, "Updated design.");
    assert.deepEqual(service.listSources().map(({ id }) => id), [second.source.id]);

    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("version creation rejects missing stable identity before writing", () => {
  const { database, service } = fixture();
  try {
    assert.throws(
      () =>
        service.importSource({
          kind: "chat",
          title: "No identity",
          createVersion: true,
          records: [{ kind: "message", content: "Content." }],
        }),
      /requires an external ID/u,
    );
    assert.equal(
      (database.prepare("SELECT count(*) AS count FROM sources").get() as { count: number })
        .count,
      0,
    );
  } finally {
    database.close();
  }
});
