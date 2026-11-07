import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityControlService,
  ContinuityConversationCatalogService,
  ContinuityConversationJournalPrivacyService,
  ContinuityMemoryService,
  ContinuityPersonaBehaviorService,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityConversationRepository,
  SqliteContinuityConversationJournalPrivacyRepository,
  SqliteContinuityMemoryRepository,
  SqliteContinuityPersonaBehaviorRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  SqliteReviewPolicyRepository,
  ReviewAutomationService,
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
      format: string;
      records: Array<{ id: string; authorRole: string; content: string }>;
      proposals: Array<{ proposalIndex: number }>;
    };
    if (payload.format === "memtextual.sensitivity_classification_input") {
      return JSON.stringify({
        assessments: payload.proposals.map(({ proposalIndex }) => ({
          proposalIndex,
          sensitivity: "normal",
          confidence: 1,
          reasonCodes: ["normal_content"],
        })),
      });
    }
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
    const policyIngestion = new SqliteIngestionRepository(
      database,
      memoryRepository,
    );
    new ReviewAutomationService(
      policyIngestion,
      new SqliteReviewPolicyRepository(database, policyIngestion),
    ).setPolicy(
      {
        scopeId: persona.relationship.scopeId,
        name: "Trust assessed Codex extraction",
        mode: "automatic_threshold",
        conditions: {
          minimumConfidence: 1,
          trustedProposerIds: [
            "openai.codex-app-server.ambient-extraction",
          ],
        },
      },
      { actor: "user", explicitUserAction: true },
    );
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

    assert.equal(result.captureRecord.status, "pending");
    await runtime.close();
    const storedCapture = database.prepare(
      `SELECT status FROM continuity_conversation_turn_captures WHERE id = ?`,
    ).get(result.captureRecord.id) as { status: string };
    assert.equal(storedCapture.status, "captured");
    assert.equal(host.structuredTasks.length, 2);
    assert.equal(host.structuredTasks[0]?.model, "gpt-runtime-test");
    assert.equal(host.structuredTasks[1]?.model, "gpt-runtime-test");
    const candidates = ingestion.listCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.assertion, "Steve prefers tea.");
    assert.equal(candidates[0]?.status, "accepted");
    assert.equal(candidates[0]?.sensitivity, "normal");
    assert.notEqual(candidates[0]?.acceptedMemoryId, null);
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
      sensitivity_assessment_status: "assessed",
      assessed_sensitivity: "normal",
      sensitivity_classifier_id:
        "openai.codex-app-server.sensitivity-classification",
    });

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
        conversationPrivacy: new ContinuityConversationJournalPrivacyService(
          new SqliteContinuityConversationJournalPrivacyRepository(database),
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
    const waitForCaptureStatus = async (
      conversationId: string,
      captureId: string,
      status: "captured" | "failed",
    ) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const detailResponse = await request(
          `/api/conversations/${encodeURIComponent(conversationId)}`,
          undefined,
          "GET",
        );
        assert.equal(detailResponse.status, 200);
        const detail = JSON.parse(detailResponse.body) as {
          turns: Array<{
            id: string;
            status: string;
            failureCode: string | null;
          }>;
        };
        const capture = detail.turns.find(({ id }) => id === captureId);
        if (capture?.status === status) {
          return capture;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error(`Capture ${captureId} did not reach ${status}.`);
    };

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
    const journaledTurn = JSON.parse(turnResponse.body) as {
      captureRecord: { id: string; status: string };
    };
    assert.equal(journaledTurn.captureRecord.status, "pending");
    await waitForCaptureStatus(
      conversation.id,
      journaledTurn.captureRecord.id,
      "captured",
    );
    assert.equal(hostAdapter.structuredTasks.length, 2);
    assert.equal(ingestion.listCandidates().length, 1);
    assert.equal(ingestion.listCandidates()[0]?.status, "pending");

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
    assert.equal(failedCaptureResponse.status, 200);
    assert.equal(failedCaptureResponse.body.includes("mthg_"), false);
    const failedCapture = JSON.parse(failedCaptureResponse.body) as {
      turn: { assistantText: string };
      captureRecord: { id: string; status: string; failureCode: string };
    };
    assert.equal(failedCapture.turn.assistantText, "I will remember that.");
    assert.equal(failedCapture.captureRecord.status, "pending");
    const storedFailure = await waitForCaptureStatus(
      conversation.id,
      failedCapture.captureRecord.id,
      "failed",
    );
    assert.equal(storedFailure.failureCode, "ambient_capture_failed");

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
    const journalPreviewResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/journal-purge-preview`,
      undefined,
      "GET",
    );
    assert.equal(journalPreviewResponse.status, 200);
    const journalPreview = JSON.parse(journalPreviewResponse.body) as {
      canPurge: boolean;
      turnCount: number;
      sourceRecordCount: number;
      candidateCount: number;
      confirmation: string;
      externalCopiesNotModified: boolean;
    };
    assert.equal(journalPreview.canPurge, true);
    assert.equal(journalPreview.turnCount, 2);
    assert.equal(journalPreview.sourceRecordCount, 4);
    assert.equal(journalPreview.candidateCount, 2);
    assert.equal(journalPreview.externalCopiesNotModified, true);
    const journalPurgeResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}/journal-purge`,
      {
        reason: "User requested local conversation removal.",
        confirmation: journalPreview.confirmation,
        acknowledgePermanentActiveDatabaseDeletion: true,
        acknowledgeExternalCopiesMayRemain: true,
      },
    );
    assert.equal(journalPurgeResponse.status, 200);
    const journalReceipt = JSON.parse(journalPurgeResponse.body) as {
      deletedRowCounts: Record<string, number>;
      externalCopiesNotModified: boolean;
    };
    assert.equal(journalReceipt.deletedRowCounts.conversationTurnCaptures, 2);
    assert.equal(journalReceipt.deletedRowCounts.sourceRecords, 4);
    assert.equal(journalReceipt.externalCopiesNotModified, true);
    assert.equal(ingestion.listCandidates().length, 0);
    const purgedConversationResponse = await request(
      `/api/conversations/${encodeURIComponent(conversation.id)}`,
      undefined,
      "GET",
    );
    assert.equal(purgedConversationResponse.status, 200);
    const purgedConversation = JSON.parse(purgedConversationResponse.body) as {
      summary: { journalPurge: { receiptId: string } | null; turnCount: number };
      turns: unknown[];
    };
    assert.notEqual(purgedConversation.summary.journalPurge, null);
    assert.equal(purgedConversation.summary.turnCount, 0);
    assert.deepEqual(purgedConversation.turns, []);
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
