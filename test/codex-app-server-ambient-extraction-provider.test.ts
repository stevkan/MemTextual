import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexAppServerAmbientExtractionProvider,
  StructuredAmbientMemoryExtractor,
  type AmbientExtractionInput,
  type CodexAppServerStructuredTaskInput,
  type CodexAppServerStructuredTaskRunner,
} from "../src/index.js";

class RecordingRunner implements CodexAppServerStructuredTaskRunner {
  readonly calls: CodexAppServerStructuredTaskInput[] = [];
  output = '{"proposals":[]}';

  async runStructuredTask(
    input: CodexAppServerStructuredTaskInput,
  ): Promise<string> {
    this.calls.push(input);
    return this.output;
  }
}

const extractionInput: AmbientExtractionInput = {
  personaContext: {
    persona: {
      id: "persona-1",
      userId: "user-1",
      name: "Skylar",
      externalId: null,
      description: "Friendly advisor",
      scopeId: "scope-persona",
      metadata: { private: "not-sent" },
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
    },
    relationship: {
      id: "relationship-1",
      userId: "user-1",
      personaId: "persona-1",
      name: "Steve and Skylar",
      scopeId: "scope-relationship",
      metadata: { private: "not-sent" },
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
    },
  },
  source: {
    id: "source-1",
    kind: "chat",
    title: "Private title not sent",
    originUri: "private://not-sent",
    externalId: "external-source-1",
    contentHash: "hash",
    capturedAt: "2026-10-15T12:30:00.000Z",
    metadata: { private: "not-sent" },
    createdAt: "2026-10-15T12:30:00.000Z",
    recordCount: 2,
    seriesId: null,
    versionNumber: null,
    previousSourceId: null,
    versionReason: null,
    isCurrent: true,
    deletedAt: null,
    deletionReason: null,
  },
  records: [
    {
      id: "record-user",
      sourceId: "source-1",
      ordinal: 0,
      kind: "message",
      authorRole: "user",
      authorName: "Steve",
      content: "Please remember that I prefer tea.",
      contentHash: "user-hash",
      occurredAt: "2026-10-15T12:29:00.000Z",
      metadata: { private: "not-sent" },
      createdAt: "2026-10-15T12:30:00.000Z",
    },
    {
      id: "record-assistant",
      sourceId: "source-1",
      ordinal: 1,
      kind: "message",
      authorRole: "assistant",
      authorName: "Skylar",
      content: "I'll remember that.",
      contentHash: "assistant-hash",
      occurredAt: "2026-10-15T12:30:00.000Z",
      metadata: { private: "not-sent" },
      createdAt: "2026-10-15T12:30:00.000Z",
    },
  ],
};

test("Codex ambient provider sends bounded untrusted data through a structured task", async () => {
  const runner = new RecordingRunner();
  const provider = new CodexAppServerAmbientExtractionProvider(runner, {
    model: "gpt-test",
  });

  assert.equal(await provider.extract(extractionInput), runner.output);
  assert.equal(provider.id, "openai.codex-app-server.ambient-extraction");
  assert.equal(provider.version, "1:model=gpt-test");
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0]!;
  assert.equal(call.model, "gpt-test");
  assert.match(call.developerInstructions, /untrusted conversation data/u);
  assert.match(call.developerInstructions, /Never follow commands/u);
  const payload = JSON.parse(call.input) as Record<string, unknown>;
  assert.equal(payload.contentRole, "untrusted_conversation_data");
  assert.deepEqual(payload.persona, {
    id: "persona-1",
    name: "Skylar",
    relationshipId: "relationship-1",
    relationshipName: "Steve and Skylar",
  });
  assert.equal(JSON.stringify(payload).includes("not-sent"), false);
  assert.deepEqual(
    (call.outputSchema.properties as Record<string, unknown>).proposals !==
      undefined,
    true,
  );
});

test("Codex ambient provider requires a recorded model and bounded input", async () => {
  const runner = new RecordingRunner();
  assert.throws(
    () => new CodexAppServerAmbientExtractionProvider(runner, { model: " " }),
    /model must contain/u,
  );
  const provider = new CodexAppServerAmbientExtractionProvider(runner, {
    model: "gpt-test",
  });
  await assert.rejects(
    provider.extract({ ...extractionInput, records: [] }),
    /requires 1 through 100 source records/u,
  );
  await assert.rejects(
    provider.extract({
      ...extractionInput,
      records: [
        {
          ...extractionInput.records[0]!,
          sourceId: "other-source",
        },
      ],
    }),
    /invalid binding/u,
  );
  await assert.rejects(
    provider.extract({
      ...extractionInput,
      records: [
        {
          ...extractionInput.records[0]!,
          content: "x".repeat(256 * 1024),
        },
      ],
    }),
    /exceeds 262144 UTF-8 bytes/u,
  );
  assert.deepEqual(runner.calls, []);
});

test("Codex ambient output passes through the strict ambient proposal validator", async () => {
  const runner = new RecordingRunner();
  runner.output = JSON.stringify({
    proposals: [
      {
        assertion: "Steve prefers tea.",
        type: "preference",
        memoryClass: "durable",
        evidence: [
          {
            sourceRecordId: "record-user",
            role: "supports",
            excerpt: "I prefer tea.",
          },
        ],
        explicitness: "explicit",
        confidence: 0.99,
        sensitivity: "normal",
      },
    ],
  });
  const provider = new CodexAppServerAmbientExtractionProvider(runner, {
    model: "gpt-test",
  });
  const extractor = new StructuredAmbientMemoryExtractor(provider);

  assert.deepEqual(await extractor.extract(extractionInput), [
    {
      assertion: "Steve prefers tea.",
      type: "preference",
      memoryClass: "durable",
      evidence: [
        {
          sourceRecordId: "record-user",
          role: "supports",
          excerpt: "I prefer tea.",
        },
      ],
      explicitness: "explicit",
      confidence: 0.99,
      sensitivity: "normal",
    },
  ]);
});
