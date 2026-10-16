import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  AuthorizedHostEventCaptureService,
  ContinuityConversationCaptureError,
  ContinuityConversationReconciliationCaptureError,
  ContinuityConversationService,
  ContinuityConversationTurnAdapter,
  HostAuthorizationService,
  IngestionService,
  PersonaService,
  SqliteContinuityConversationRepository,
  SqliteHostEventRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  StructuredAmbientMemoryExtractor,
  continuityContextFormat,
  continuityContextFormatVersion,
  continuityConversationTurnEventKind,
  openMemTextualDatabase,
  type CompletedConversationTurn,
  type ContinuityContextComposition,
  type ContinuityContextQuery,
  type ConversationHost,
  type ConversationSession,
  type HistoricalCompletedConversationTurn,
  type SendConversationTurnInput,
  type StartConversationInput,
} from "../src/index.js";

class FakeConversationHost implements ConversationHost {
  readonly identity = {
    adapterId: "test.conversation-host",
    adapterVersion: "1",
  };
  readonly started: StartConversationInput[] = [];
  readonly resumed: string[] = [];
  readonly sent: SendConversationTurnInput[] = [];
  readonly history: HistoricalCompletedConversationTurn[] = [];
  readonly historyRequests: string[] = [];
  nextConversation = 1;
  nextTurn = 1;

  async startConversation(
    input: StartConversationInput = {},
  ): Promise<ConversationSession> {
    this.started.push(input);
    return { id: `host-conversation-${this.nextConversation++}` };
  }

  async resumeConversation(conversationId: string): Promise<ConversationSession> {
    this.resumed.push(conversationId);
    return { id: conversationId };
  }

  async sendTurn(input: SendConversationTurnInput): Promise<CompletedConversationTurn> {
    this.sent.push(input);
    const turn: CompletedConversationTurn = {
      conversationId: input.conversationId,
      turnId: `host-turn-${this.nextTurn++}`,
      userText: input.text,
      assistantText: "I will keep that in mind.",
      status: "completed",
    };
    if (input.memoryContext !== undefined) {
      const context = JSON.parse(input.memoryContext.contextJson) as {
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
    }
    return turn;
  }

  async listCompletedTurns(
    conversationId: string,
  ): Promise<HistoricalCompletedConversationTurn[]> {
    this.historyRequests.push(conversationId);
    return this.history.filter((turn) => turn.conversationId === conversationId);
  }

  async close(): Promise<void> {}
}

class FakeContextProvider {
  readonly queries: ContinuityContextQuery[] = [];

  async compose(query: ContinuityContextQuery): Promise<ContinuityContextComposition> {
    this.queries.push(query);
    const payload = {
      format: continuityContextFormat,
      formatVersion: continuityContextFormatVersion,
      contentRole: "memory_data" as const,
      personaId: query.personaId,
      items: [],
    };
    const contextJson = JSON.stringify(payload);
    return {
      payload,
      contextJson,
      utf8Bytes: Buffer.byteLength(contextJson, "utf8"),
      limits: {
        maxItems: 10,
        maxUtf8Bytes: 8_192,
        maxEpisodicItems: 10,
        maxDurableItems: 10,
      },
      consideredCount: 0,
      omittedCount: 0,
      omissionCounts: { itemLimit: 0, byteLimit: 0, classLimit: 0 },
    };
  }
}

function fixture(options: { failExtraction?: boolean } = {}) {
  const extractionState = { fail: options.failExtraction === true };
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memories = new SqliteMemoryRepository(database);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memories),
  );
  const personaRepository = new SqlitePersonaRepository(database);
  const personas = new PersonaService(personaRepository);
  const user = personas.createUser({ displayName: "Steve" });
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const host = new FakeConversationHost();
  const hostEvents = new SqliteHostEventRepository(database);
  const authorizations = new HostAuthorizationService(hostEvents, personaRepository);
  const authorization = authorizations.authorize(
    {
      userId: user.id,
      personaId: skylar.persona.id,
      hostId: host.identity.adapterId,
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  );
  const ambient = new AmbientMemoryService(
    ingestion,
    personaRepository,
    new StructuredAmbientMemoryExtractor({
      id: "test.conversation-extractor",
      version: "1",
      extract: async ({ records }) => {
        if (extractionState.fail) {
          throw new Error("extraction unavailable");
        }
        return JSON.stringify({
          proposals: [
            {
              assertion: "Steve prefers concise responses.",
              type: "preference",
              memoryClass: "durable",
              evidence: [{ sourceRecordId: records[0]!.id }],
              explicitness: "explicit",
              confidence: 1,
            },
          ],
        });
      },
    }),
    {
      id: "test.normal-classifier",
      version: "1",
      classify: async () => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["no_sensitive_signal"],
      }),
    },
  );
  const capture = new AuthorizedHostEventCaptureService(
    hostEvents,
    personaRepository,
    ambient,
    new ContinuityConversationTurnAdapter(host.identity),
  );
  const contexts = new FakeContextProvider();
  const conversations = new ContinuityConversationService(
    new SqliteContinuityConversationRepository(database),
    personaRepository,
    contexts,
    host,
    capture,
    { now: () => new Date("2026-10-15T12:00:00.000Z") },
  );
  return {
    advisor,
    authorization,
    authorizations,
    conversations,
    contexts,
    database,
    extractionState,
    host,
    ingestion,
    skylar,
  };
}

test("binds a host conversation to one persona and captures an exact completed turn", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
      model: "test-model",
    });
    const result = await setup.conversations.sendTurn({
      conversationId: conversation.id,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
      text: "Please keep your responses concise.",
      context: { limit: 5 },
    });

    assert.equal(conversation.externalConversationId, "host-conversation-1");
    assert.equal(conversation.personaId, setup.skylar.persona.id);
    assert.equal(setup.host.started[0]?.model, "test-model");
    assert.deepEqual(setup.host.resumed, ["host-conversation-1"]);
    assert.equal(setup.contexts.queries[0]?.personaId, setup.skylar.persona.id);
    assert.equal(setup.contexts.queries[0]?.text, "Please keep your responses concise.");
    assert.equal(setup.host.sent[0]?.memoryContext?.contentRole, "memory_data");
    assert.equal(result.capture.createdCandidateCount, 1);
    assert.equal(result.capture.receipt.personaId, setup.skylar.persona.id);
    assert.equal(result.captureRecord.status, "captured");
    assert.equal(result.captureRecord.attemptCount, 1);
    assert.equal(result.captureRecord.receiptId, result.capture.receipt.id);
    assert.equal(result.captureRecord.userText, "Please keep your responses concise.");
    assert.equal(result.captureRecord.assistantText, "I will keep that in mind.");
    assert.deepEqual(setup.conversations.listRecoverableCaptures(setup.skylar.persona.id), []);

    const source = setup.ingestion.listSources()[0];
    assert.ok(source);
    const records = setup.ingestion.getSourceRecords(source.id);
    assert.deepEqual(
      records.map(({ authorRole, authorName, content }) => ({
        authorRole,
        authorName,
        content,
      })),
      [
        {
          authorRole: "user",
          authorName: null,
          content: "Please keep your responses concise.",
        },
        {
          authorRole: "assistant",
          authorName: "Skylar",
          content: "I will keep that in mind.",
        },
      ],
    );
    assert.equal(setup.ingestion.listCandidates()[0]?.status, "pending");
  } finally {
    setup.database.close();
  }
});

test("rejects cross-persona and revoked access before context retrieval or host use", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.advisor.persona.id,
        grant: setup.authorization.grant,
        text: "Cross the boundary.",
      }),
      /conversation not found/u,
    );
    assert.equal(setup.contexts.queries.length, 0);
    assert.equal(setup.host.sent.length, 0);

    setup.authorizations.revoke(setup.authorization.authorization.id, {
      actor: "user",
      explicitUserAction: true,
    });
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
        text: "This must not reach the host.",
      }),
      /authorization was rejected/u,
    );
    assert.equal(setup.contexts.queries.length, 0);
    assert.equal(setup.host.sent.length, 0);
  } finally {
    setup.database.close();
  }
});

test("database constraints reject a conversation bound across personas", () => {
  const setup = fixture();
  try {
    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO continuity_conversations (
               id, user_id, persona_id, relationship_id, authorization_id,
               host_id, external_conversation_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "cross-persona-conversation",
            setup.advisor.persona.userId,
            setup.advisor.persona.id,
            setup.advisor.relationship.id,
            setup.authorization.authorization.id,
            setup.host.identity.adapterId,
            "host-cross-persona",
          ),
      /does not match its authorization/u,
    );
  } finally {
    setup.database.close();
  }
});

test("preserves a completed response when ambient capture fails visibly", async () => {
  const setup = fixture({ failExtraction: true });
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
        text: "Remember this.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContinuityConversationCaptureError);
        assert.equal(error.turn.assistantText, "I will keep that in mind.");
        assert.equal(error.captureRecord.status, "failed");
        assert.equal(error.captureRecord.attemptCount, 1);
        assert.equal(error.captureRecord.failureCode, "ambient_capture_failed");
        assert.equal(error.captureRecord.receiptId, null);
        assert.match(String(error.cause), /extraction unavailable/u);
        return true;
      },
    );
    assert.equal(setup.ingestion.listSources().length, 1);
    assert.equal(setup.ingestion.listCandidates().length, 0);
    const [recoverable] = setup.conversations.listRecoverableCaptures(
      setup.skylar.persona.id,
    );
    assert.ok(recoverable);
    assert.equal(recoverable.userText, "Remember this.");
    assert.equal(recoverable.assistantText, "I will keep that in mind.");
    assert.equal(
      setup.conversations.listRecoverableCaptures(setup.advisor.persona.id).length,
      0,
    );
  } finally {
    setup.database.close();
  }
});

test("retries a durable failed capture without regenerating the host response", async () => {
  const setup = fixture({ failExtraction: true });
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    let failedCaptureId = "";
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
        text: "Remember this without another model turn.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContinuityConversationCaptureError);
        failedCaptureId = error.captureRecord.id;
        return true;
      },
    );
    setup.extractionState.fail = false;
    const result = await setup.conversations.retryCapture({
      captureId: failedCaptureId,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
    });

    assert.equal(setup.host.sent.length, 1);
    assert.equal(result.captureRecord.status, "captured");
    assert.equal(result.captureRecord.attemptCount, 2);
    assert.equal(result.captureRecord.failureCode, null);
    assert.equal(result.captureRecord.receiptId, result.capture.receipt.id);
    assert.equal(setup.ingestion.listCandidates().length, 1);
    assert.deepEqual(setup.conversations.listRecoverableCaptures(setup.skylar.persona.id), []);

    const replay = await setup.conversations.retryCapture({
      captureId: failedCaptureId,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
    });
    assert.equal(replay.capture.reused, true);
    assert.equal(replay.captureRecord.attemptCount, 2);
    assert.equal(setup.host.sent.length, 1);
  } finally {
    setup.database.close();
  }
});

test("denies cross-persona and revoked recovery before retrying capture", async () => {
  const setup = fixture({ failExtraction: true });
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    let failedCaptureId = "";
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
        text: "Keep the failed record isolated.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContinuityConversationCaptureError);
        failedCaptureId = error.captureRecord.id;
        return true;
      },
    );
    await assert.rejects(
      setup.conversations.retryCapture({
        captureId: failedCaptureId,
        personaId: setup.advisor.persona.id,
        grant: setup.authorization.grant,
      }),
      /capture not found/u,
    );
    setup.authorizations.revoke(setup.authorization.authorization.id, {
      actor: "user",
      explicitUserAction: true,
    });
    await assert.rejects(
      setup.conversations.retryCapture({
        captureId: failedCaptureId,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
      }),
      /authorization was rejected/u,
    );
    assert.equal(
      setup.conversations.listRecoverableCaptures(setup.skylar.persona.id)[0]
        ?.attemptCount,
      1,
    );
  } finally {
    setup.database.close();
  }
});

test("database constraints preserve capture payloads and reject mismatched receipts", async () => {
  const setup = fixture({ failExtraction: true });
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    let failedCaptureId = "";
    await assert.rejects(
      setup.conversations.sendTurn({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
        text: "Immutable failed turn.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof ContinuityConversationCaptureError);
        failedCaptureId = error.captureRecord.id;
        return true;
      },
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `UPDATE continuity_conversation_turn_captures
             SET user_text = 'Changed' WHERE id = ?`,
          )
          .run(failedCaptureId),
      /payload cannot be changed/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO continuity_conversation_turn_captures (
               id, conversation_id, external_turn_id, external_event_id,
               user_text, assistant_text, completed_at, context_format_version,
               memory_revision_ids_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          )
          .run(
            "invalid-revisions",
            conversation.id,
            "invalid-turn",
            "invalid-event",
            "User text",
            "Assistant text",
            "2026-10-15T12:00:00.000Z",
            1,
            JSON.stringify(["duplicate", "duplicate"]),
          ),
      /memory revisions are invalid/u,
    );

    setup.extractionState.fail = false;
    const successful = await setup.conversations.sendTurn({
      conversationId: conversation.id,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
      text: "A different successful turn.",
    });
    assert.throws(
      () =>
        setup.database
          .prepare(
            `UPDATE continuity_conversation_turn_captures
             SET status = 'captured', attempt_count = attempt_count + 1,
                 last_attempt_at = ?, failure_code = NULL, receipt_id = ?,
                 captured_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            "2026-10-15T12:01:00.000Z",
            successful.capture.receipt.id,
            "2026-10-15T12:01:00.000Z",
            "2026-10-15T12:01:00.000Z",
            failedCaptureId,
          ),
      /receipt does not match/u,
    );
  } finally {
    setup.database.close();
  }
});

test("reconciles a missing host turn without generating another response", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    setup.host.history.push({
      conversationId: conversation.externalConversationId,
      turnId: "host-turn-lost-before-journal",
      userText: "Remember the recovered turn.",
      assistantText: "Recovered response.",
      status: "completed",
      completedAt: "2026-10-15T11:59:00.000Z",
      memoryContext: {
        personaId: setup.skylar.persona.id,
        formatVersion: continuityContextFormatVersion,
        memoryRevisionIds: [],
      },
    });

    const result = await setup.conversations.reconcileConversationHistory({
      conversationId: conversation.id,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
    });
    assert.equal(result.hostTurnCount, 1);
    assert.equal(result.existingCaptureCount, 0);
    assert.equal(result.recovered.length, 1);
    assert.equal(result.recovered[0]?.captureRecord.status, "captured");
    assert.equal(
      result.recovered[0]?.captureRecord.completedAt,
      "2026-10-15T11:59:00.000Z",
    );
    assert.equal(setup.host.sent.length, 0);
    assert.equal(setup.ingestion.listCandidates().length, 1);
    const source = setup.ingestion.listSources()[0];
    assert.ok(source);
    assert.deepEqual(
      setup.ingestion.getSourceRecords(source.id).map(({ authorRole, content }) => ({
        authorRole,
        content,
      })),
      [
        { authorRole: "user", content: "Remember the recovered turn." },
        { authorRole: "assistant", content: "Recovered response." },
      ],
    );

    const replay = await setup.conversations.reconcileConversationHistory({
      conversationId: conversation.id,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
    });
    assert.equal(replay.existingCaptureCount, 1);
    assert.deepEqual(replay.recovered, []);
    assert.equal(setup.ingestion.listCandidates().length, 1);
  } finally {
    setup.database.close();
  }
});

test("reconciliation preflights persona and revocation before reading host history", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    await assert.rejects(
      setup.conversations.reconcileConversationHistory({
        conversationId: conversation.id,
        personaId: setup.advisor.persona.id,
        grant: setup.authorization.grant,
      }),
      /conversation not found/u,
    );
    setup.authorizations.revoke(setup.authorization.authorization.id, {
      actor: "user",
      explicitUserAction: true,
    });
    await assert.rejects(
      setup.conversations.reconcileConversationHistory({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
      }),
      /authorization was rejected/u,
    );
    assert.deepEqual(setup.host.historyRequests, []);
  } finally {
    setup.database.close();
  }
});

test("reconciliation validates all host history before creating recovery records", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    setup.host.history.push(
      {
        conversationId: conversation.externalConversationId,
        turnId: "valid-missing-turn",
        userText: "Valid but must not be partially recovered.",
        assistantText: "Valid response.",
        status: "completed",
        completedAt: "2026-10-15T11:58:00.000Z",
        memoryContext: {
          personaId: setup.skylar.persona.id,
          formatVersion: continuityContextFormatVersion,
          memoryRevisionIds: [],
        },
      },
      {
        conversationId: conversation.externalConversationId,
        turnId: "cross-persona-turn",
        userText: "Invalid persona context.",
        assistantText: "Invalid response.",
        status: "completed",
        completedAt: "2026-10-15T11:59:00.000Z",
        memoryContext: {
          personaId: setup.advisor.persona.id,
          formatVersion: continuityContextFormatVersion,
          memoryRevisionIds: [],
        },
      },
    );
    await assert.rejects(
      setup.conversations.reconcileConversationHistory({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
      }),
      /persona boundary/u,
    );
    assert.equal(
      (
        setup.database
          .prepare(
            "SELECT count(*) AS count FROM continuity_conversation_turn_captures",
          )
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    setup.database.close();
  }
});

test("reconciliation journals extraction failures for explicit retry", async () => {
  const setup = fixture({ failExtraction: true });
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    setup.host.history.push({
      conversationId: conversation.externalConversationId,
      turnId: "historical-extraction-failure",
      userText: "Recover me later.",
      assistantText: "Durable historical response.",
      status: "completed",
      completedAt: "2026-10-15T11:57:00.000Z",
      memoryContext: {
        personaId: setup.skylar.persona.id,
        formatVersion: continuityContextFormatVersion,
        memoryRevisionIds: [],
      },
    });
    await assert.rejects(
      setup.conversations.reconcileConversationHistory({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof ContinuityConversationReconciliationCaptureError,
        );
        assert.equal(error.captureRecord.status, "failed");
        assert.equal(error.captureRecord.failureCode, "ambient_capture_failed");
        return true;
      },
    );
    const recoverable = setup.conversations.listRecoverableCaptures(
      setup.skylar.persona.id,
    );
    assert.equal(recoverable.length, 1);
    assert.equal(recoverable[0]?.externalTurnId, "historical-extraction-failure");
    assert.equal(setup.host.sent.length, 0);
  } finally {
    setup.database.close();
  }
});

test("reconciliation rejects host disagreement before recovering other turns", async () => {
  const setup = fixture();
  try {
    const conversation = await setup.conversations.startConversation({
      personaId: setup.skylar.persona.id,
      authorizationId: setup.authorization.authorization.id,
      grant: setup.authorization.grant,
    });
    await setup.conversations.sendTurn({
      conversationId: conversation.id,
      personaId: setup.skylar.persona.id,
      grant: setup.authorization.grant,
      text: "Journaled turn.",
    });
    const existingHistory = setup.host.history[0];
    assert.ok(existingHistory);
    existingHistory.assistantText = "Host history was changed.";
    setup.host.history.unshift({
      conversationId: conversation.externalConversationId,
      turnId: "missing-before-mismatch",
      userText: "This must remain untouched.",
      assistantText: "Not recovered after mismatch.",
      status: "completed",
      completedAt: "2026-10-15T11:59:00.000Z",
      memoryContext: {
        personaId: setup.skylar.persona.id,
        formatVersion: continuityContextFormatVersion,
        memoryRevisionIds: [],
      },
    });

    await assert.rejects(
      setup.conversations.reconcileConversationHistory({
        conversationId: conversation.id,
        personaId: setup.skylar.persona.id,
        grant: setup.authorization.grant,
      }),
      /does not match host history/u,
    );
    assert.equal(
      (
        setup.database
          .prepare(
            "SELECT count(*) AS count FROM continuity_conversation_turn_captures",
          )
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    setup.database.close();
  }
});
