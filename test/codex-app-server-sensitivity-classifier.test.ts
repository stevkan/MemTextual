import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexAppServerSensitivityClassifier,
  type AmbientSensitivityInput,
  type CodexAppServerStructuredTaskInput,
  type CodexAppServerStructuredTaskRunner,
  type SourceRecord,
} from "../src/index.js";

class RecordingRunner implements CodexAppServerStructuredTaskRunner {
  readonly calls: CodexAppServerStructuredTaskInput[] = [];
  output = JSON.stringify({
    assessments: [
      {
        proposalIndex: 0,
        sensitivity: "normal",
        confidence: 0.98,
        reasonCodes: ["normal_content"],
      },
    ],
  });

  async runStructuredTask(
    input: CodexAppServerStructuredTaskInput,
  ): Promise<string> {
    this.calls.push(input);
    return this.output;
  }
}

function sensitivityInput(
  overrides: Partial<AmbientSensitivityInput> = {},
): AmbientSensitivityInput {
  const record: SourceRecord = {
    id: "record-user",
    sourceId: "source-1",
    ordinal: 0,
    kind: "message",
    authorRole: "user",
    authorName: "Steve",
    content: "Please remember that I prefer tea.",
    contentHash: "record-hash",
    occurredAt: "2026-10-16T12:00:00.000Z",
    metadata: { private: "not-sent" },
    createdAt: "2026-10-16T12:00:00.000Z",
  };
  return {
    personaContext: {
      persona: {
        id: "persona-1",
        userId: "user-1",
        name: "Skylar",
        externalId: null,
        description: "Private description not sent",
        scopeId: "scope-persona",
        metadata: { private: "not-sent" },
        createdAt: "2026-10-16T12:00:00.000Z",
        updatedAt: "2026-10-16T12:00:00.000Z",
      },
      relationship: {
        id: "relationship-1",
        userId: "user-1",
        personaId: "persona-1",
        name: "Private relationship name not sent",
        scopeId: "scope-relationship",
        metadata: { private: "not-sent" },
        createdAt: "2026-10-16T12:00:00.000Z",
        updatedAt: "2026-10-16T12:00:00.000Z",
      },
    },
    source: {
      id: "source-1",
      kind: "chat",
      title: "Private source title not sent",
      originUri: "private://not-sent",
      externalId: "external-source-1",
      contentHash: "source-hash",
      capturedAt: "2026-10-16T12:00:00.000Z",
      metadata: { private: "not-sent" },
      createdAt: "2026-10-16T12:00:00.000Z",
      recordCount: 1,
      seriesId: null,
      versionNumber: null,
      previousSourceId: null,
      versionReason: null,
      isCurrent: true,
      deletedAt: null,
      deletionReason: null,
    },
    records: [record],
    proposal: {
      assertion: "Steve prefers tea.",
      type: "preference",
      memoryClass: "durable",
      evidence: [
        {
          sourceRecordId: record.id,
          role: "supports",
          excerpt: "I prefer tea.",
        },
      ],
      explicitness: "explicit",
      confidence: 1,
      sensitivity: "normal",
      metadata: { private: "not-sent" },
    },
    evidenceRecords: [record],
    ...overrides,
  };
}

test("Codex sensitivity classifier batches bounded untrusted proposals", async () => {
  const runner = new RecordingRunner();
  runner.output = JSON.stringify({
    assessments: [
      {
        proposalIndex: 1,
        sensitivity: "normal",
        confidence: 0.85,
        reasonCodes: ["normal_content"],
      },
      {
        proposalIndex: 0,
        sensitivity: "sensitive",
        confidence: 0.95,
        reasonCodes: ["relationship_private", "personal_contact"],
      },
    ],
  });
  const classifier = new CodexAppServerSensitivityClassifier(runner, {
    model: "gpt-test",
  });
  const second = sensitivityInput({
    proposal: {
      ...sensitivityInput().proposal,
      assertion: "Steve likes coffee.",
      sensitivity: "restricted",
    },
  });

  assert.deepEqual(
    await classifier.classifyBatch([sensitivityInput(), second]),
    [
      {
        sensitivity: "sensitive",
        confidence: 0.95,
        reasonCodes: ["personal_contact", "relationship_private"],
      },
      {
        sensitivity: "restricted",
        confidence: 0.85,
        reasonCodes: ["declared_sensitivity_floor", "normal_content"],
      },
    ],
  );
  assert.equal(classifier.id, "openai.codex-app-server.sensitivity-classification");
  assert.equal(classifier.version, "1:model=gpt-test");
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0]!;
  assert.equal(call.model, "gpt-test");
  assert.match(call.developerInstructions, /untrusted memory proposals/u);
  assert.match(call.developerInstructions, /declared sensitivity is a lower bound/u);
  const payload = JSON.parse(call.input) as {
    contentRole: string;
    proposals: unknown[];
  };
  assert.equal(payload.contentRole, "untrusted_memory_proposals");
  assert.equal(payload.proposals.length, 2);
  assert.equal(JSON.stringify(payload).includes("not-sent"), false);
  assert.ok(
    (call.outputSchema.properties as Record<string, unknown>).assessments !==
      undefined,
  );
});

test("Codex sensitivity classifier rejects invalid bindings and output", async () => {
  const runner = new RecordingRunner();
  assert.throws(
    () => new CodexAppServerSensitivityClassifier(runner, { model: " " }),
    /model must contain/u,
  );
  const classifier = new CodexAppServerSensitivityClassifier(runner, {
    model: "gpt-test",
  });
  const invalid = sensitivityInput();
  invalid.evidenceRecords = [
    { ...invalid.evidenceRecords[0]!, sourceId: "other-source" },
  ];
  await assert.rejects(
    classifier.classify(invalid),
    /invalid binding/u,
  );
  assert.equal(runner.calls.length, 0);

  runner.output = JSON.stringify({
    assessments: [
      {
        proposalIndex: 1,
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["normal_content"],
      },
    ],
  });
  await assert.rejects(
    classifier.classify(sensitivityInput()),
    /duplicate or missing proposal indexes/u,
  );

  runner.output = JSON.stringify({
    assessments: [
      {
        proposalIndex: 0,
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["invented_reason"],
      },
    ],
  });
  await assert.rejects(
    classifier.classify(sensitivityInput()),
    /output failed validation/u,
  );
});

test("Codex sensitivity classifier avoids provider use for an empty batch", async () => {
  const runner = new RecordingRunner();
  const classifier = new CodexAppServerSensitivityClassifier(runner, {
    model: "gpt-test",
  });
  assert.deepEqual(await classifier.classifyBatch([]), []);
  assert.deepEqual(runner.calls, []);
});

test("Codex sensitivity classifier rejects oversized batches before provider use", async () => {
  const runner = new RecordingRunner();
  const classifier = new CodexAppServerSensitivityClassifier(runner, {
    model: "gpt-test",
  });
  await assert.rejects(
    classifier.classifyBatch(
      Array.from({ length: 51 }, () => sensitivityInput()),
    ),
    /at most 50 proposals/u,
  );
  await assert.rejects(
    classifier.classifyBatch(
      Array.from({ length: 50 }, (_, index) => {
        const input = sensitivityInput();
        input.proposal = {
          ...input.proposal,
          assertion: `${index}:${"x".repeat(9_998)}`,
        };
        return input;
      }),
    ),
    /exceeds 262144 UTF-8 bytes/u,
  );
  assert.deepEqual(runner.calls, []);
});
