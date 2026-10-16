import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  IngestionService,
  PersonaService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
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
  closeCalls = 0;

  async startConversation(): Promise<ConversationSession> {
    return { id: "host-conversation-1" };
  }

  async resumeConversation(conversationId: string): Promise<ConversationSession> {
    return { id: conversationId };
  }

  async sendTurn(input: SendConversationTurnInput): Promise<CompletedConversationTurn> {
    const turn = {
      conversationId: input.conversationId,
      turnId: "host-turn-1",
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
    const payload = JSON.parse(input.input) as {
      records: Array<{ id: string; authorRole: string; content: string }>;
    };
    const userRecord = payload.records.find(
      ({ authorRole }) => authorRole === "user",
    )!;
    return JSON.stringify({
      proposals: [
        {
          assertion: "Steve prefers tea.",
          type: "preference",
          memoryClass: "durable",
          evidence: [
            {
              sourceRecordId: userRecord.id,
              role: "supports",
              excerpt: "I prefer tea.",
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
