import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  IngestionService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  formatCandidateForReview,
  openMemTextualDatabase,
  reviewPendingCandidates,
  type CandidateReviewIO,
} from "../src/index.js";

class ScriptedReviewIO implements CandidateReviewIO {
  public readonly output: string[] = [];

  public constructor(private readonly answers: string[]) {}

  public async ask(prompt: string): Promise<string> {
    this.output.push(prompt);
    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error("The scripted review ran out of answers.");
    }
    return answer;
  }

  public write(message: string): void {
    this.output.push(message);
  }
}

function reviewFixture() {
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
    name: "Review CLI",
  });
  const imported = service.importSource({
    kind: "chat",
    title: "Review inputs",
    records: [
      { kind: "message", authorRole: "user", content: "First candidate evidence." },
      { kind: "message", authorRole: "user", content: "Second candidate evidence." },
      { kind: "message", authorRole: "user", content: "Third candidate evidence." },
    ],
  });

  for (const [index, record] of imported.records.entries()) {
    service.proposeCandidate({
      assertion: `Candidate assertion ${index + 1}.`,
      type: "fact",
      scopeId: scope.id,
      evidence: [{ sourceRecordId: record.id }],
      proposedBy: "extractor",
    });
  }
  return { database, service };
}

test("review session accepts, skips, and rejects pending candidates", async () => {
  const { database, service } = reviewFixture();
  const io = new ScriptedReviewIO([
    "accept",
    "Confirmed from source.",
    "skip",
    "reject",
    "Not durable memory.",
  ]);

  try {
    const summary = await reviewPendingCandidates(service, io);

    assert.deepEqual(summary, {
      reviewed: 2,
      accepted: 1,
      rejected: 1,
      skipped: 1,
      failed: 0,
      quitEarly: false,
    });
    assert.equal(service.listCandidates("accepted").length, 1);
    assert.equal(service.listCandidates("rejected").length, 1);
    assert.equal(service.listCandidates("pending").length, 1);
    assert.ok(io.output.some((line) => line.includes("First candidate evidence.") || line.includes("Second candidate evidence.") || line.includes("Third candidate evidence.")));

    const memoryCount = database
      .prepare("SELECT count(*) AS count FROM memory_items")
      .get() as { count: number };
    assert.equal(memoryCount.count, 1);
  } finally {
    database.close();
  }
});

test("review session can quit without changing candidate state", async () => {
  const { database, service } = reviewFixture();
  const io = new ScriptedReviewIO(["q"]);

  try {
    const summary = await reviewPendingCandidates(service, io);
    assert.equal(summary.quitEarly, true);
    assert.equal(summary.reviewed, 0);
    assert.equal(service.listCandidates("pending").length, 3);
  } finally {
    database.close();
  }
});

test("candidate formatting reports unavailable evidence safely", () => {
  const { database, service } = reviewFixture();

  try {
    const candidate = service.listCandidates("pending")[0]!;
    const output = formatCandidateForReview(
      candidate,
      new Map(candidate.evidence.map(({ sourceRecordId }) => [sourceRecordId, null])),
    );
    assert.match(output, /Source record is unavailable/u);
  } finally {
    database.close();
  }
});

test("review CLI starts against a new database", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-review-"));

  try {
    const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolveProcess, rejectProcess) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("src", "cli", "review.ts"),
            "--database",
            join(temporaryDirectory, "review.db"),
            "--migrations",
            resolve("migrations"),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", rejectProcess);
        child.on("close", (code) => resolveProcess({ stdout, stderr, code }));
      },
    );

    assert.equal(output.code, 0);
    assert.equal(output.stderr, "");
    assert.match(output.stdout, /No pending memory candidates/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
