import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  continuityPersonaMemoryExportFormat,
  ContinuityControlService,
  ContinuityMemoryService,
  ExplicitContinuityControlActionRequiredError,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityMemoryRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  type AmbientMemoryExtractor,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const memoryService = new MemoryService(memoryRepository);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const personaRepository = new SqlitePersonaRepository(database);
  const personaService = new PersonaService(personaRepository);
  const continuity = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memoryRepository),
  );
  const control = new ContinuityControlService(
    new SqliteContinuityControlRepository(database),
    personaRepository,
    continuity,
    memoryService,
    ingestion,
  );
  const extractor: AmbientMemoryExtractor = {
    id: "test.control-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: records[0]!.content,
        type: "fact",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
        explicitness: "explicit",
        confidence: 1,
      },
    ],
  };
  const ambient = new AmbientMemoryService(
    ingestion,
    personaRepository,
    extractor,
    {
      id: "test.control-classifier",
      version: "1",
      classify: () => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["normal_content"],
      }),
    },
  );
  const user = personaService.createUser({ displayName: "Steve" });
  const skylar = personaService.createPersona({
    userId: user.id,
    name: "Skylar",
  });
  const advisor = personaService.createPersona({
    userId: user.id,
    name: "Advisor",
  });
  return {
    advisor,
    ambient,
    continuity,
    control,
    database,
    ingestion,
    skylar,
  };
}

async function capture(
  setup: ReturnType<typeof fixture>,
  personaId: string,
  content: string,
  provenance?: {
    conversationId: string;
    turnId: string;
    occurredAt: string;
  },
) {
  return setup.ambient.captureInteraction({
    personaId,
    source: {
      kind: "chat",
      title: "Control-service evidence",
      ...(provenance === undefined
        ? {}
        : {
            metadata: {
              continuityConversation: {
                conversationId: provenance.conversationId,
                turnId: provenance.turnId,
              },
            },
          }),
      records: [
        {
          kind: "message",
          authorRole: "user",
          content,
          ...(provenance === undefined
            ? {}
            : { occurredAt: provenance.occurredAt }),
        },
      ],
    },
  });
}

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("control queue is persona-bound and resolves evidence-backed candidates", async () => {
  const setup = fixture();
  try {
    const skylarCapture = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers concise answers.",
      {
        conversationId: "conversation-skylar-1",
        turnId: "turn-skylar-1",
        occurredAt: "2026-11-06T22:15:30.000Z",
      },
    );
    await capture(
      setup,
      setup.advisor.persona.id,
      "Steve discussed an advisory question.",
    );
    setup.ingestion.proposeCandidate({
      assertion: "Unprofiled candidate in the same scope.",
      type: "fact",
      scopeId: setup.skylar.relationship.scopeId,
      evidence: [
        {
          sourceRecordId: skylarCapture.candidates[0]!.evidence[0]!.sourceRecordId,
        },
      ],
    });

    const queue = setup.control.listCandidateQueue({
      personaId: setup.skylar.persona.id,
      status: "pending",
    });
    assert.equal(queue.length, 1);
    assert.equal(queue[0]?.candidate.id, skylarCapture.candidates[0]?.id);
    assert.equal(queue[0]?.memoryClass, "durable");
    assert.deepEqual(queue[0]?.provenance, [
      {
        sourceId: skylarCapture.source.id,
        sourceTitle: "Control-service evidence",
        sourceKind: "chat",
        sourceCapturedAt: null,
        sourceCreatedAt: skylarCapture.source.createdAt,
        recordOccurredAt: "2026-11-06T22:15:30.000Z",
        conversationId: "conversation-skylar-1",
        turnId: "turn-skylar-1",
      },
    ]);

    const review = setup.control.getCandidateReview(
      setup.skylar.persona.id,
      skylarCapture.candidates[0]!.id,
    );
    assert.equal(review.evidence[0]?.record?.content, "Steve prefers concise answers.");
    assert.equal(
      review.evidence[0]?.provenance?.conversationId,
      "conversation-skylar-1",
    );
    assert.equal(review.evidence[0]?.provenance?.turnId, "turn-skylar-1");
    assert.throws(
      () =>
        setup.control.getCandidateReview(
          setup.advisor.persona.id,
          skylarCapture.candidates[0]!.id,
        ),
      /not found for persona/u,
    );
    assert.throws(
      () =>
        setup.control.resolveCandidate({
          personaId: setup.skylar.persona.id,
          candidateId: skylarCapture.candidates[0]!.id,
          resolution: { outcome: "create" },
        }),
      ExplicitContinuityControlActionRequiredError,
    );

    const resolved = setup.control.resolveCandidate(
      {
        personaId: setup.skylar.persona.id,
        candidateId: skylarCapture.candidates[0]!.id,
        resolution: { outcome: "create" },
      },
      { ...explicitUserAction, note: "Confirmed preference." },
    );
    assert.equal(resolved.candidate.status, "accepted");
    assert.equal(resolved.memory?.assertion, "Steve prefers concise answers.");
    assert.equal(
      setup.control.listMemories(setup.skylar.persona.id).length,
      1,
    );
    assert.equal(
      setup.control.getMemoryDetail(
        setup.skylar.persona.id,
        resolved.memory!.id,
      ).history.length,
      1,
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("control mutations require explicit user action and preserve lifecycle history", () => {
  const setup = fixture();
  try {
    assert.throws(
      () =>
        setup.control.createMemory({
          personaId: setup.skylar.persona.id,
          memoryClass: "durable",
          assertion: "The user prefers direct answers.",
          type: "preference",
        }),
      ExplicitContinuityControlActionRequiredError,
    );
    const created = setup.control.createMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryClass: "durable",
        assertion: "The user prefers direct answers.",
        type: "preference",
      },
      explicitUserAction,
    );
    assert.throws(
      () =>
        setup.control.setPinned(
          setup.skylar.persona.id,
          created.memory.id,
          true,
        ),
      ExplicitContinuityControlActionRequiredError,
    );
    assert.equal(
      setup.control.setPinned(
        setup.skylar.persona.id,
        created.memory.id,
        true,
        explicitUserAction,
      ).isPinned,
      true,
    );
    assert.equal(
      setup.control.setProtected(
        setup.skylar.persona.id,
        created.memory.id,
        true,
        explicitUserAction,
      ).isProtected,
      true,
    );
    const revised = setup.control.reviseMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryId: created.memory.id,
        revision: {
          assertion: "The user prefers concise, direct answers.",
          changeKind: "corrected",
        },
      },
      explicitUserAction,
    );
    assert.equal(revised.revisionNumber, 2);
    assert.equal(
      setup.control.getMemoryDetail(
        setup.skylar.persona.id,
        created.memory.id,
      ).history.length,
      2,
    );
    assert.equal(
      setup.control.archiveMemory(
        setup.skylar.persona.id,
        created.memory.id,
        explicitUserAction,
      ).status,
      "archived",
    );
    assert.equal(
      setup.control.restoreMemory(
        setup.skylar.persona.id,
        created.memory.id,
        explicitUserAction,
      ).status,
      "active",
    );
    assert.equal(
      setup.control.deleteMemory(
        {
          personaId: setup.skylar.persona.id,
          memoryId: created.memory.id,
          deletion: { reason: "User requested removal." },
        },
        explicitUserAction,
      ).status,
      "deleted",
    );
    assert.equal(
      setup.control.previewMemoryPurge(
        setup.skylar.persona.id,
        created.memory.id,
      ).canPurge,
      true,
    );
    assert.equal(
      setup.control.restoreDeletedMemory(
        setup.skylar.persona.id,
        created.memory.id,
        explicitUserAction,
      ).status,
      "active",
    );
    assert.throws(
      () =>
        setup.control.getMemoryDetail(
          setup.advisor.persona.id,
          created.memory.id,
        ),
      /not found for persona/u,
    );
    const events = setup.database
      .prepare(
        `SELECT event_type FROM audit_events
         WHERE memory_id = ? ORDER BY occurred_at, rowid`,
      )
      .all(created.memory.id) as Array<{ event_type: string }>;
    assert.ok(events.some(({ event_type }) => event_type === "pinned"));
    assert.ok(events.some(({ event_type }) => event_type === "protected"));
    assert.ok(events.some(({ event_type }) => event_type === "revised"));
  } finally {
    setup.database.close();
  }
});

test("persona-memory export includes complete history only for the selected persona", () => {
  const setup = fixture();
  try {
    const skylarMemory = setup.control.createMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryClass: "durable",
        assertion: "Original Skylar memory.",
        type: "fact",
      },
      explicitUserAction,
    );
    setup.control.reviseMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryId: skylarMemory.memory.id,
        revision: {
          assertion: "Corrected Skylar memory.",
          changeKind: "corrected",
        },
      },
      explicitUserAction,
    );
    setup.control.deleteMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryId: skylarMemory.memory.id,
        deletion: { reason: "Included deleted memory in user export." },
      },
      explicitUserAction,
    );
    setup.control.createMemory(
      {
        personaId: setup.advisor.persona.id,
        memoryClass: "episodic",
        assertion: "Advisor-only memory.",
        type: "fact",
      },
      explicitUserAction,
    );

    const export_ = setup.control.exportPersonaMemories(setup.skylar.persona.id);
    assert.equal(export_.format, continuityPersonaMemoryExportFormat);
    assert.equal(export_.formatVersion, 1);
    assert.equal(export_.personaContext.persona.id, setup.skylar.persona.id);
    assert.equal(Number.isNaN(Date.parse(export_.exportedAt)), false);
    assert.equal(export_.memories.length, 1);
    assert.equal(export_.memories[0]?.personaMemory.memory.id, skylarMemory.memory.id);
    assert.equal(export_.memories[0]?.personaMemory.memory.status, "deleted");
    assert.deepEqual(
      export_.memories[0]?.history.map(({ assertion }) => assertion),
      ["Original Skylar memory.", "Corrected Skylar memory."],
    );
    assert.equal(JSON.stringify(export_).includes("Advisor-only memory."), false);
  } finally {
    setup.database.close();
  }
});

test("control resolutions reject targets owned by another persona", async () => {
  const setup = fixture();
  try {
    const captured = await capture(
      setup,
      setup.skylar.persona.id,
      "A corrected preference.",
    );
    const advisorMemory = setup.control.createMemory(
      {
        personaId: setup.advisor.persona.id,
        memoryClass: "durable",
        assertion: "Advisor-only memory.",
        type: "fact",
      },
      explicitUserAction,
    );
    assert.throws(
      () =>
        setup.control.resolveCandidate(
          {
            personaId: setup.skylar.persona.id,
            candidateId: captured.candidates[0]!.id,
            resolution: {
              outcome: "revise",
              targetMemoryId: advisorMemory.memory.id,
            },
          },
          explicitUserAction,
        ),
      /not found for persona/u,
    );
    assert.equal(
      setup.ingestion.getCandidate(captured.candidates[0]!.id)?.status,
      "pending",
    );
  } finally {
    setup.database.close();
  }
});
