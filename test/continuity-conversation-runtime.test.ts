import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityControlService,
  ContinuityConversationCatalogService,
  ContinuityMemoryService,
  ContinuityPersonaBehaviorService,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityConversationRepository,
  SqliteContinuityMemoryRepository,
  SqliteContinuityPersonaBehaviorRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
  createContinuityConsoleApplication,
  createContinuityConversationRuntime,
  openMemTextualDatabase,
  type CodexAppServerStructuredTaskInput,
  type CompletedConversationTurn,
  type ConversationGrantBinding,
  type ConversationGrantStore,
  type ConversationGrantStoreReceipt,
  type ConversationSession,
  type HistoricalCompletedConversationTurn,
  type SendConversationTurnInput,
  type StoreConversationGrantInput,
  type StructuredConversationHost,
} from "../src/index.js";

class MemoryGrantStore implements ConversationGrantStore {
  readonly #grants = new Map<string, StoreConversationGrantInput>();

  async store(
    input: StoreConversationGrantInput,
  ): Promise<ConversationGrantStoreReceipt> {
    if (this.#grants.has(input.authorizationId)) {
      throw new Error("grant already stored");
    }
    this.#grants.set(input.authorizationId, { ...input });
    return { authorizationId: input.authorizationId, created: true };
  }

  async load(binding: ConversationGrantBinding): Promise<string | null> {
    const stored = this.#grants.get(binding.authorizationId);
    return stored !== undefined && sameBinding(stored, binding)
      ? stored.grant
      : null;
  }

  async delete(binding: ConversationGrantBinding): Promise<boolean> {
    const stored = this.#grants.get(binding.authorizationId);
    return stored !== undefined && sameBinding(stored, binding)
      ? this.#grants.delete(binding.authorizationId)
      : false;
  }
}

function sameBinding(
  left: ConversationGrantBinding,
  right: ConversationGrantBinding,
): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.userId === right.userId &&
    left.personaId === right.personaId &&
    left.relationshipId === right.relationshipId &&
    left.hostId === right.hostId
  );
}

class RuntimeHost implements StructuredConversationHost {
  readonly identity = {
    adapterId: "openai.codex-app-server",
    adapterVersion: "1",
  };
  readonly structuredTasks: CodexAppServerStructuredTaskInput[] = [];
  readonly history: HistoricalCompletedConversationTurn[] = [];
  readonly deleted: string[] = [];
  closeCalls = 0;
  failStructuredTask = false;
  nextTurn = 1;

  async startConversation(): Promise<ConversationSession> {
    return { id: "host-conversation-1" };
  }

  async resumeConversation(conversationId: string): Promise<ConversationSession> {
    return { id: conversationId };
  }

  async deleteConversation(conversationId: string) {
    this.deleted.push(conversationId);
    return { conversationId, deleted: true as const };
  }

  async sendTurn(input: SendConversationTurnInput): Promise<CompletedConversationTurn> {
    const turn = {
      conversationId: input.conversationId,
      turnId: `host-turn-${this.nextTurn++}`,
      userText: input.text,
      assistantText: "I will remember that.",
      status: "completed" as const,
    };
    const context = JSON.parse(input.memoryContext!.contextJson) as {
      personaId: string;
      formatVersion: number;
      items: Array<{ revisionId: string }>;
    };
    this.history.push({
      ...turn,
      completedAt: "2026-10-15T12:00:00.000Z",
      memoryContext: {
        personaId: context.personaId,
        formatVersion: context.formatVersion,
        memoryRevisionIds: context.items.map(({ revisionId }) => revisionId),
      },
    });
    return turn;
  }

  async listCompletedTurns(
    conversationId: string,
  ): Promise<HistoricalCompletedConversationTurn[]> {
    return this.history.filter((turn) => turn.conversationId === conversationId);
  }

  async runStructuredTask(
    input: CodexAppServerStructuredTaskInput,
  ): Promise<string> {
    this.structuredTasks.push(input);
    if (this.failStructuredTask) {
      throw new Error("structured extraction unavailable");
    }
    const payload = JSON.parse(input.input) as {
      records: Array<{ id: string; authorRole: string; content: string }>;
    };
    const userRecord = payload.records.find(
      ({ authorRole }) => authorRole === "user",
    )!;
    return JSON.stringify({
      proposals: [
        {
          assertion: userRecord.content.includes("tea")
            ? "Steve prefers tea."
            : "Steve prefers coffee.",
          type: "preference",
          memoryClass: "durable",
          evidence: [
            {
              sourceRecordId: userRecord.id,
              role: "supports",
              excerpt: userRecord.content,
            },
          ],
          explicitness: "explicit",
          confidence: 1,
          sensitivity: "normal",
        },
      ],
    });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

test("production runtime composes protected conversation and ambient capture boundaries", async () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const host = new RuntimeHost();
  const runtime = createContinuityConversationRuntime({
    database,
    extractionModel: "gpt-runtime-test",
    grantStore: new MemoryGrantStore(),
    host,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  try {
    const memoryRepository = new SqliteMemoryRepository(database);
    const personaRepository = new SqlitePersonaRepository(database);
    const personas = new PersonaService(personaRepository);
    const ingestion = new IngestionService(
      new SqliteIngestionRepository(database, memoryRepository),
    );
    const user = personas.createUser({ displayName: "Steve" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const authorization = await runtime.authorizations.authorize(
      {
        userId: user.id,
        personaId: persona.persona.id,
        hostId: host.identity.adapterId,
        allowedEventKinds: [continuityConversationTurnEventKind],
      },
      { actor: "user", explicitUserAction: true },
    );
    const conversation = await runtime.client.startConversation({
      personaId: persona.persona.id,
      authorizationId: authorization.id,
    });
    const result = await runtime.client.sendTurn({
      conversationId: conversation.id,
      personaId: persona.persona.id,
      text: "I prefer tea.",
    });

    assert.equal(result.capture.createdCandidateCount, 1);
    assert.equal(host.structuredTasks.length, 1);
    assert.equal(host.structuredTasks[0]?.model, "gpt-runtime-test");
    const candidates = ingestion.listCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.assertion, "Steve prefers tea.");
    assert.equal(candidates[0]?.status, "pending");
    assert.equal(candidates[0]?.sensitivity, "sensitive");
    const ambientProfile = database
      .prepare(
        `SELECT sensitivity_assessment_status, assessed_sensitivity,
                sensitivity_classifier_id
         FROM ambient_candidate_profiles WHERE candidate_id = ?`,
      )
      .get(candidates[0]!.id) as {
      sensitivity_assessment_status: string;
      assessed_sensitivity: string;
      sensitivity_classifier_id: string;
    };
    assert.deepEqual(ambientProfile, {
      sensitivity_assessment_status: "unassessed",
      assessed_sensitivity: "sensitive",
      sensitivity_classifier_id: "memtextual.unassessed",
    });

    await runtime.close();
    await runtime.close();
    assert.equal(host.closeCalls, 1);
    assert.doesNotThrow(() => database.prepare("SELECT 1").get());
  } finally {
    await runtime.close();
    database.close();
  }
});

test("console conversation API keeps identity and grants behind the loopback boundary", async () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const hostAdapter = new RuntimeHost();
  const runtime = createContinuityConversationRuntime({
    database,
    extractionModel: "gpt-runtime-test",
    grantStore: new MemoryGrantStore(),
    host: hostAdapter,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  try {
    const memories = new SqliteMemoryRepository(database);
    const personasRepository = new SqlitePersonaRepository(database);
    const personas = new PersonaService(personasRepository);
    const user = personas.createUser({ displayName: "Steve" });
    const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
    const ingestion = new IngestionService(
      new SqliteIngestionRepository(database, memories),
    );
    const control = new ContinuityControlService(
      new SqliteContinuityControlRepository(database),
      personasRepository,
      new ContinuityMemoryService(
        new SqliteContinuityMemoryRepository(database, memories),
      ),
      new MemoryService(memories),
      ingestion,
    );
    const application = createContinuityConsoleApplication(
      {
        behaviors: new ContinuityPersonaBehaviorService(
          new SqliteContinuityPersonaBehaviorRepository(database),
        ),
        conversations: new ContinuityConversationCatalogService(
          new SqliteContinuityConversationRepository(database),
          personasRepository,
        ),
        control,
        conversationRuntime: runtime,
        personaContext: persona,
      },
      "t".repeat(32),
    );
    const origin = "http://127.0.0.1:47321";
    const request = (url: string, body?: unknown, method = "POST") =>
      application.handle(
        {
          method,
          url,
          headers: {
            authorization: `Bearer ${"t".repeat(32)}`,
            host: "127.0.0.1:47321",
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  origin,
                }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        origin,
      );

    const dashboard = await request("/api/dashboard", undefined, "GET");
    assert.equal(dashboard.status, 200);
    assert.deepEqual(
      (JSON.parse(dashboard.body) as { conversationRuntime: unknown })
        .conversationRuntime,
      { enabled: true },
    );

    const rejectedIdentityOverride = await request(
      "/api/conversation-authorizations",
      { personaId: "another-persona" },
    );
    assert.equal(rejectedIdentityOverride.status, 400);

    const authorizationResponse = await request(
      "/api/conversation-authorizations",
      {},
    );
    assert.equal(authorizationResponse.status, 201);
    assert.equal(authorizationResponse.body.includes("mthg_"), false);
    const authorization = JSON.parse(authorizationResponse.body) as {
      id: string;
      hostId: string;
      personaId: string;
    };
    assert.equal(authorization.hostId, hostAdapter.identity.adapterId);
    assert.equal(authorization.personaId, persona.persona.id);

    const listedResponse = await request(
      "/api/conversation-authorizations",
      undefined,
      "GET",
    );
    assert.equal(listedResponse.status, 200);
    assert.equal(listedResponse.body.includes("mthg_"), false);
    assert.deepEqual(
      (JSON.parse(listedResponse.body) as Array<{ id: string }>).map(({ id }) => id),
      [authorization.id],
    );

    const startResponse = await request("/api/conversations", {
      authorizationId: authorization.id,
    });
    assert.equal(startResponse.status, 201);
    assert.equal(startResponse.body.includes("mthg_"), false);
    const conversation = JSON.parse(startResponse.body) as { id: string };

    const rejectedGrantInput = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/turns`,
      { text: "I prefer tea.", grant: `mthg_${"a".repeat(43)}` },
    );
    assert.equal(rejectedGrantInput.status, 400);
    assert.equal(hostAdapter.structuredTasks.length, 0);

    const turnResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/turns`,
      { text: "I prefer tea." },
    );
    assert.equal(turnResponse.status, 200);
    assert.equal(turnResponse.body.includes("mthg_"), false);
    assert.equal(hostAdapter.structuredTasks.length, 1);
    assert.equal(ingestion.listCandidates().length, 1);

    const leaveResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/leave`,
      {},
    );
    assert.equal(leaveResponse.status, 200);
    const openResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/open`,
      {},
    );
    assert.equal(openResponse.status, 200);

    hostAdapter.failStructuredTask = true;
    const failedCaptureResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/turns`,
      { text: "I also prefer coffee." },
    );
    assert.equal(failedCaptureResponse.status, 409);
    assert.equal(failedCaptureResponse.body.includes("mthg_"), false);
    const failedCapture = JSON.parse(failedCaptureResponse.body) as {
      status: string;
      turn: { assistantText: string };
      captureRecord: { id: string; status: string; failureCode: string };
      cause?: unknown;
    };
    assert.equal(failedCapture.status, "capture_failed");
    assert.equal(failedCapture.turn.assistantText, "I will remember that.");
    assert.equal(failedCapture.captureRecord.status, "failed");
    assert.equal(failedCapture.captureRecord.failureCode, "ambient_capture_failed");
    assert.equal(failedCapture.cause, undefined);

    const recoveryResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/open`,
      {},
    );
    assert.equal(recoveryResponse.status, 409);
    assert.equal(
      (JSON.parse(recoveryResponse.body) as { status: string }).status,
      "recovery_required",
    );

    hostAdapter.failStructuredTask = false;
    const retryResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/captures/${encodeURIComponent(failedCapture.captureRecord.id)}/retry`,
      {},
    );
    assert.equal(retryResponse.status, 200);
    assert.equal(retryResponse.body.includes("mthg_"), false);
    assert.equal(
      (JSON.parse(retryResponse.body) as { captureRecord: { status: string } })
        .captureRecord.status,
      "captured",
    );

    const recoveredOpenResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/open`,
      {},
    );
    assert.equal(recoveredOpenResponse.status, 200);

    const secondLeave = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/leave`,
      {},
    );
    assert.equal(secondLeave.status, 200);
    const deletionPreviewResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/host-delete-preview`,
      undefined,
      "GET",
    );
    assert.equal(deletionPreviewResponse.status, 200);
    const deletionPreview = JSON.parse(deletionPreviewResponse.body) as {
      confirmation: string;
      localJournalWillRemain: boolean;
      snapshotsAndBackupsMayRemain: boolean;
    };
    assert.equal(deletionPreview.localJournalWillRemain, true);
    assert.equal(deletionPreview.snapshotsAndBackupsMayRemain, true);
    const deletionResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/host-delete`,
      {
        confirmation: deletionPreview.confirmation,
        acknowledgeLocalDataRemains: true,
        acknowledgeBackupsMayRemain: true,
      },
    );
    assert.equal(deletionResponse.status, 200);
    assert.equal(
      (JSON.parse(deletionResponse.body) as { status: string }).status,
      "deleted",
    );
    assert.deepEqual(hostAdapter.deleted, ["host-conversation-1"]);
    const rejectedDeletedOpen = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/open`,
      {},
    );
    assert.equal(rejectedDeletedOpen.status, 400);
    assert.match(rejectedDeletedOpen.body, /external host thread.*deleted/iu);
    const revokeResponse = await request(
      `/api/conversation-authorizations/${encodeURIComponent(authorization.id)}/revoke`,
      {},
    );
    assert.equal(revokeResponse.status, 200);
    assert.equal(revokeResponse.body.includes("mthg_"), false);
    assert.equal(
      (JSON.parse(revokeResponse.body) as { authorization: { status: string } })
        .authorization.status,
      "revoked",
    );
  } finally {
    await runtime.close();
    database.close();
  }
});

test("runtime rejects missing extraction configuration before host use", () => {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const host = new RuntimeHost();
  try {
    assert.throws(
      () =>
        createContinuityConversationRuntime({
          database,
          extractionModel: " ",
          grantStore: new MemoryGrantStore(),
          host,
        }),
      /extractionModel must not be empty/u,
    );
    assert.equal(host.structuredTasks.length, 0);
    assert.equal(host.closeCalls, 0);
  } finally {
    database.close();
  }
});
