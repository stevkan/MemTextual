import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  ContinuityConversationCatalogService,
  ContinuityControlService,
  ContinuityMemoryService,
  ContinuityPersonaBehaviorService,
  createContinuityConsoleApplication,
  continuityConversationTurnEventKind,
  HostAuthorizationService,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityConversationRepository,
  SqliteContinuityMemoryRepository,
  SqliteContinuityPersonaBehaviorRepository,
  SqliteIngestionRepository,
  SqliteHostEventRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  startContinuityConsole,
  type AmbientMemoryExtractor,
  type ContinuityConsoleApplication,
  type ContinuityConsoleRequest,
} from "../src/index.js";
import { continuityConsoleJavaScript } from "../src/ui/continuity-console-page.js";

const origin = "http://127.0.0.1:47321";
const host = "127.0.0.1:47321";

test("Continuity console browser script parses as JavaScript", () => {
  assert.doesNotThrow(() => new Function(continuityConsoleJavaScript));
});

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const personaRepository = new SqlitePersonaRepository(database);
  const personas = new PersonaService(personaRepository);
  const user = personas.createUser({ displayName: "Steve" });
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const continuity = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memoryRepository),
  );
  const control = new ContinuityControlService(
    new SqliteContinuityControlRepository(database),
    personaRepository,
    continuity,
    new MemoryService(memoryRepository),
    ingestion,
  );
  const behaviors = new ContinuityPersonaBehaviorService(
    new SqliteContinuityPersonaBehaviorRepository(database),
  );
  const conversationRepository = new SqliteContinuityConversationRepository(
    database,
  );
  const conversations = new ContinuityConversationCatalogService(
    conversationRepository,
    personaRepository,
  );
  const authorizations = new HostAuthorizationService(
    new SqliteHostEventRepository(database),
    personaRepository,
  );
  const skylarAuthorization = authorizations.authorize(
    {
      userId: user.id,
      personaId: skylar.persona.id,
      hostId: "test.console-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  );
  const advisorAuthorization = authorizations.authorize(
    {
      userId: user.id,
      personaId: advisor.persona.id,
      hostId: "test.console-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  );
  const extractor: AmbientMemoryExtractor = {
    id: "test.console-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: records[0]!.content,
        type: "preference",
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
      id: "test.console-classifier",
      version: "1",
      classify: () => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["normal_content"],
      }),
    },
  );
  return {
    advisor,
    advisorAuthorization,
    ambient,
    behaviors,
    control,
    conversationRepository,
    conversations,
    database,
    skylar,
    skylarAuthorization,
    user,
  };
}

async function capture(
  setup: ReturnType<typeof fixture>,
  personaId: string,
  content: string,
) {
  return setup.ambient.captureInteraction({
    personaId,
    source: {
      kind: "chat",
      title: "Console test",
      records: [{ kind: "message", authorRole: "user", content }],
    },
  });
}

function createJournaledConversation(
  setup: ReturnType<typeof fixture>,
  input: {
    id: string;
    persona: ReturnType<typeof fixture>["skylar"];
    authorizationId: string;
    userText: string;
  },
) {
  setup.conversationRepository.createConversation({
    id: input.id,
    userId: setup.user.id,
    personaId: input.persona.persona.id,
    relationshipId: input.persona.relationship.id,
    authorizationId: input.authorizationId,
    hostId: "test.console-host",
    externalConversationId: `external-${input.id}`,
    behaviorProfileId: null,
    behaviorProfileRevision: null,
  });
  return setup.conversationRepository.createTurnCapture({
    id: `capture-${input.id}`,
    conversationId: input.id,
    externalTurnId: `turn-${input.id}`,
    externalEventId: `event-${input.id}`,
    userText: input.userText,
    assistantText: "Exact assistant response.",
    completedAt: "2126-10-15T19:00:00.000Z",
    contextFormatVersion: 1,
    memoryRevisionIds: [],
  });
}

function request(
  application: ContinuityConsoleApplication,
  token: string,
  input: ContinuityConsoleRequest,
) {
  return application.handle(
    {
      ...input,
      headers: {
        host,
        authorization: `Bearer ${token}`,
        ...input.headers,
      },
    },
    origin,
  );
}

test("Continuity console requires its session token and persona boundary", async () => {
  const setup = fixture();
  const token = "t".repeat(32);
  try {
    const skylarCapture = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers concise answers.",
    );
    const advisorCapture = await capture(
      setup,
      setup.advisor.persona.id,
      "Advisor-only candidate.",
    );
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );

    const page = await application.handle(
      { method: "GET", url: "/", headers: { host } },
      origin,
    );
    assert.equal(page.status, 200);
    assert.match(page.body, /MemTextual Continuity/u);
    assert.match(page.headers["Content-Security-Policy"] ?? "", /default-src 'self'/u);
    assert.equal(page.headers["X-Frame-Options"], "DENY");
    assert.equal(page.body.includes(token), false);

    const script = await application.handle(
      { method: "GET", url: "/app.js", headers: { host } },
      origin,
    );
    assert.equal(script.status, 200);
    assert.equal(script.body.includes(token), false);

    const unauthorized = await application.handle(
      { method: "GET", url: "/api/dashboard", headers: { host } },
      origin,
    );
    assert.equal(unauthorized.status, 401);

    const dashboardResponse = await request(application, token, {
      method: "GET",
      url: "/api/dashboard",
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = JSON.parse(dashboardResponse.body) as {
      persona: { id: string; name: string };
      candidates: Array<{ candidate: { id: string } }>;
      memories: unknown[];
      conversationRuntime: { enabled: boolean };
    };
    assert.deepEqual(dashboard.persona, {
      id: setup.skylar.persona.id,
      name: "Skylar",
    });
    assert.deepEqual(
      dashboard.candidates.map(({ candidate }) => candidate.id),
      [skylarCapture.candidates[0]!.id],
    );
    assert.equal(dashboard.memories.length, 0);
    assert.deepEqual(dashboard.conversationRuntime, { enabled: false });

    const disabledConversationRuntime = await request(application, token, {
      method: "POST",
      url: "/api/conversation-authorizations",
      headers: { "content-type": "application/json", origin },
      body: "{}",
    });
    assert.equal(disabledConversationRuntime.status, 503);

    const reviewResponse = await request(application, token, {
      method: "GET",
      url: `/api/candidates/${skylarCapture.candidates[0]!.id}`,
    });
    const review = JSON.parse(reviewResponse.body) as {
      evidence: Array<{ record: { content: string } | null }>;
    };
    assert.equal(review.evidence[0]?.record?.content, "Steve prefers concise answers.");

    const crossPersona = await request(application, token, {
      method: "GET",
      url: `/api/candidates/${advisorCapture.candidates[0]!.id}`,
    });
    assert.equal(crossPersona.status, 404);

    const wrongHost = await application.handle(
      {
        method: "GET",
        url: "/api/dashboard",
        headers: { host: "attacker.example", authorization: `Bearer ${token}` },
      },
      origin,
    );
    assert.equal(wrongHost.status, 421);

    const absoluteUrl = await request(application, token, {
      method: "GET",
      url: "http://attacker.example/api/dashboard",
    });
    assert.equal(absoluteUrl.status, 421);
  } finally {
    setup.database.close();
  }
});

test("Continuity console exposes only its persona conversation journal", async () => {
  const setup = fixture();
  const token = "j".repeat(32);
  try {
    createJournaledConversation(setup, {
      id: "skylar-journal",
      persona: setup.skylar,
      authorizationId: setup.skylarAuthorization.authorization.id,
      userText: "Skylar journal text.",
    });
    createJournaledConversation(setup, {
      id: "advisor-journal",
      persona: setup.advisor,
      authorizationId: setup.advisorAuthorization.authorization.id,
      userText: "Advisor-only journal text.",
    });
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );

    const dashboardResponse = await request(application, token, {
      method: "GET",
      url: "/api/dashboard",
    });
    const dashboard = JSON.parse(dashboardResponse.body) as {
      conversations: Array<{ conversation: { id: string } }>;
    };
    assert.deepEqual(
      dashboard.conversations.map(({ conversation }) => conversation.id),
      ["skylar-journal"],
    );

    const detailResponse = await request(application, token, {
      method: "GET",
      url: "/api/conversations/skylar-journal",
    });
    assert.equal(detailResponse.status, 200);
    const detail = JSON.parse(detailResponse.body) as {
      turns: Array<{ userText: string; assistantText: string }>;
    };
    assert.deepEqual(
      detail.turns.map(({ userText, assistantText }) => ({
        userText,
        assistantText,
      })),
      [
        {
          userText: "Skylar journal text.",
          assistantText: "Exact assistant response.",
        },
      ],
    );

    const crossPersona = await request(application, token, {
      method: "GET",
      url: "/api/conversations/advisor-journal",
    });
    assert.equal(crossPersona.status, 404);
  } finally {
    setup.database.close();
  }
});

test("Continuity console creates explicit persona memories with selected controls", async () => {
  const setup = fixture();
  const token = "m".repeat(32);
  try {
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );
    const mutation = {
      method: "POST",
      url: "/api/memories",
      headers: { "content-type": "application/json", origin },
    };

    const invalid = await request(application, token, {
      ...mutation,
      body: JSON.stringify({
        assertion: "Incomplete explicit memory.",
        memoryClass: "durable",
        type: "fact",
        sensitivity: "normal",
        isPinned: false,
        isProtected: false,
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(setup.control.listMemories(setup.skylar.persona.id).length, 0);

    const wrongOrigin = await request(application, token, {
      ...mutation,
      headers: { "content-type": "application/json", origin: "http://attacker.example" },
      body: JSON.stringify({
        assertion: "Origin-rejected memory.",
        memoryClass: "durable",
        type: "fact",
        sensitivity: "normal",
        retrievalPolicy: "include",
        isPinned: false,
        isProtected: false,
      }),
    });
    assert.equal(wrongOrigin.status, 403);

    const response = await request(application, token, {
      ...mutation,
      body: JSON.stringify({
        assertion: "Steve prefers concise answers.",
        memoryClass: "durable",
        type: "preference",
        sensitivity: "sensitive",
        retrievalPolicy: "manual",
        isPinned: true,
        isProtected: true,
      }),
    });
    assert.equal(response.status, 201);
    const created = JSON.parse(response.body) as {
      personaId: string;
      memoryClass: string;
      memory: {
        id: string;
        assertion: string;
        type: string;
        sensitivity: string;
        retrievalPolicy: string;
        explicitness: string;
        confidence: number;
        isPinned: boolean;
        isProtected: boolean;
      };
    };
    assert.equal(created.personaId, setup.skylar.persona.id);
    assert.equal(created.memoryClass, "durable");
    assert.deepEqual(
      {
        assertion: created.memory.assertion,
        type: created.memory.type,
        sensitivity: created.memory.sensitivity,
        retrievalPolicy: created.memory.retrievalPolicy,
        explicitness: created.memory.explicitness,
        confidence: created.memory.confidence,
        isPinned: created.memory.isPinned,
        isProtected: created.memory.isProtected,
      },
      {
        assertion: "Steve prefers concise answers.",
        type: "preference",
        sensitivity: "sensitive",
        retrievalPolicy: "manual",
        explicitness: "explicit",
        confidence: 1,
        isPinned: true,
        isProtected: true,
      },
    );
    assert.equal(setup.control.listMemories(setup.advisor.persona.id).length, 0);

    const detailResponse = await request(application, token, {
      method: "GET",
      url: `/api/memories/${created.memory.id}`,
    });
    const detail = JSON.parse(detailResponse.body) as {
      history: Array<{ createdBy: string }>;
    };
    assert.equal(detail.history[0]?.createdBy, "user");
  } finally {
    setup.database.close();
  }
});

test("Continuity console edits only its bound persona behavior", async () => {
  const setup = fixture();
  const token = "b".repeat(32);
  try {
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );
    const initial = await request(application, token, {
      method: "GET",
      url: "/api/behavior",
    });
    assert.deepEqual(JSON.parse(initial.body), { current: null, history: [] });

    const instructions = "  Be warm and candid.\nKeep answers concise.  ";
    const response = await request(application, token, {
      method: "POST",
      url: "/api/behavior",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        expectedRevisionNumber: null,
        instructions,
        enabled: true,
        note: "Initial behavior.",
      }),
    });
    assert.equal(response.status, 200);
    const created = JSON.parse(response.body) as {
      personaId: string;
      revisionNumber: number;
      instructions: string;
      enabled: boolean;
    };
    assert.equal(created.personaId, setup.skylar.persona.id);
    assert.equal(created.revisionNumber, 1);
    assert.equal(created.instructions, instructions);
    assert.equal(created.enabled, true);
    assert.equal(setup.behaviors.getProfile(setup.advisor.persona.id), null);

    const stale = await request(application, token, {
      method: "POST",
      url: "/api/behavior",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        expectedRevisionNumber: null,
        instructions: "Stale replacement.",
        enabled: true,
      }),
    });
    assert.equal(stale.status, 400);
    assert.match(JSON.parse(stale.body).error, /changed from revision null to 1/u);
  } finally {
    setup.database.close();
  }
});

test("Continuity console requires same-origin explicit mutations", async () => {
  const setup = fixture();
  const token = "u".repeat(32);
  try {
    const captured = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers direct answers.",
    );
    const candidateId = captured.candidates[0]!.id;
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );
    const mutation = {
      method: "POST",
      headers: { "content-type": "application/json" },
    };

    const missingOrigin = await request(application, token, {
      ...mutation,
      url: `/api/candidates/${candidateId}/resolve`,
      body: JSON.stringify({ outcome: "create" }),
    });
    assert.equal(missingOrigin.status, 403);

    const acceptedResponse = await request(application, token, {
      ...mutation,
      url: `/api/candidates/${candidateId}/resolve`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ outcome: "create", note: "Confirmed in UI." }),
    });
    assert.equal(acceptedResponse.status, 200);
    const accepted = JSON.parse(acceptedResponse.body) as {
      memory: { id: string } | null;
    };
    const memoryId = accepted.memory!.id;

    const pinResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/pin`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ value: true }),
    });
    assert.equal(pinResponse.status, 200);
    assert.equal((JSON.parse(pinResponse.body) as { isPinned: boolean }).isPinned, true);

    const protectResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/protect`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ value: true }),
    });
    assert.equal(protectResponse.status, 200);
    assert.equal(
      (JSON.parse(protectResponse.body) as { isProtected: boolean }).isProtected,
      true,
    );

    const memoryResponse = await request(application, token, {
      method: "GET",
      url: `/api/memories/${memoryId}`,
    });
    const detail = JSON.parse(memoryResponse.body) as {
      personaMemory: { memory: { isPinned: boolean; isProtected: boolean } };
      history: unknown[];
    };
    assert.equal(detail.personaMemory.memory.isPinned, true);
    assert.equal(detail.personaMemory.memory.isProtected, true);
    assert.equal(detail.history.length, 1);

    const correctionResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/correct`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ assertion: "Steve prefers concise, direct answers." }),
    });
    assert.equal(correctionResponse.status, 200);
    const corrected = JSON.parse(correctionResponse.body) as {
      assertion: string;
      normalizedAssertion: string | null;
      revisionNumber: number;
    };
    assert.equal(corrected.assertion, "Steve prefers concise, direct answers.");
    assert.equal(corrected.normalizedAssertion, null);
    assert.equal(corrected.revisionNumber, 2);

    const correctedDetailResponse = await request(application, token, {
      method: "GET",
      url: `/api/memories/${memoryId}`,
    });
    const correctedDetail = JSON.parse(correctedDetailResponse.body) as {
      history: Array<{ assertion: string; changeKind: string }>;
    };
    assert.deepEqual(
      correctedDetail.history.map(({ assertion, changeKind }) => ({
        assertion,
        changeKind,
      })),
      [
        { assertion: "Steve prefers direct answers.", changeKind: "created" },
        {
          assertion: "Steve prefers concise, direct answers.",
          changeKind: "corrected",
        },
      ],
    );

    const exportResponse = await request(application, token, {
      method: "GET",
      url: "/api/export",
    });
    assert.equal(exportResponse.status, 200);
    assert.equal(
      exportResponse.headers["Content-Disposition"],
      'attachment; filename="memtextual-continuity-skylar-memories.json"',
    );
    const export_ = JSON.parse(exportResponse.body) as {
      format: string;
      personaContext: { persona: { id: string } };
      memories: Array<{ history: unknown[] }>;
    };
    assert.equal(export_.format, "memtextual-continuity-persona-memories");
    assert.equal(export_.personaContext.persona.id, setup.skylar.persona.id);
    assert.equal(export_.memories.length, 1);
    assert.equal(export_.memories[0]?.history.length, 2);

    const wrongDeletionConfirmation = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/delete`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "User requested forgetting.",
        confirmation: "wrong-id",
      }),
    });
    assert.equal(wrongDeletionConfirmation.status, 400);

    const deletionResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/delete`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "User requested forgetting.",
        confirmation: memoryId,
      }),
    });
    assert.equal(deletionResponse.status, 200);
    const deleted = JSON.parse(deletionResponse.body) as {
      status: string;
      deletionReason: string | null;
    };
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.deletionReason, "User requested forgetting.");

    const wrongRestoreConfirmation = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/restore-deleted`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ confirmation: "wrong-id" }),
    });
    assert.equal(wrongRestoreConfirmation.status, 400);

    const restorationResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/restore-deleted`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ confirmation: memoryId }),
    });
    assert.equal(restorationResponse.status, 200);
    const restored = JSON.parse(restorationResponse.body) as {
      status: string;
      deletionReason: string | null;
    };
    assert.equal(restored.status, "active");
    assert.equal(restored.deletionReason, null);

    const activePurgeAttempt = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/purge`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "Permanent privacy request.",
        confirmation: memoryId,
        acknowledgePermanentRemoval: true,
        acknowledgeExternalCopiesNotModified: true,
      }),
    });
    assert.equal(activePurgeAttempt.status, 409);

    const secondDeletion = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/delete`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "Prepare explicit permanent removal.",
        confirmation: memoryId,
      }),
    });
    assert.equal(secondDeletion.status, 200);

    const previewResponse = await request(application, token, {
      method: "GET",
      url: `/api/memories/${memoryId}/purge-preview`,
    });
    assert.equal(previewResponse.status, 200);
    const preview = JSON.parse(previewResponse.body) as {
      canPurge: boolean;
      revisionCount: number;
      candidateCount: number;
      retainedSourceRecordIds: string[];
      externalCopiesNotModified: boolean;
    };
    assert.equal(preview.canPurge, true);
    assert.equal(preview.revisionCount, 2);
    assert.equal(preview.candidateCount, 1);
    assert.equal(preview.retainedSourceRecordIds.length, 1);
    assert.equal(preview.externalCopiesNotModified, true);

    const missingAcknowledgement = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/purge`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "Permanent privacy request.",
        confirmation: memoryId,
        acknowledgePermanentRemoval: true,
        acknowledgeExternalCopiesNotModified: false,
      }),
    });
    assert.equal(missingAcknowledgement.status, 400);

    const purgeResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/purge`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({
        reason: "Permanent privacy request.",
        confirmation: memoryId,
        acknowledgePermanentRemoval: true,
        acknowledgeExternalCopiesNotModified: true,
      }),
    });
    assert.equal(purgeResponse.status, 200);
    const receipt = JSON.parse(purgeResponse.body) as {
      memoryId: string;
      retainedSourceRecordCount: number;
      externalCopiesNotModified: boolean;
    };
    assert.equal(receipt.memoryId, memoryId);
    assert.equal(receipt.retainedSourceRecordCount, 1);
    assert.equal(receipt.externalCopiesNotModified, true);
    assert.equal(purgeResponse.body.includes("Steve prefers"), false);

    const purgedDetail = await request(application, token, {
      method: "GET",
      url: `/api/memories/${memoryId}`,
    });
    assert.equal(purgedDetail.status, 404);
    const dashboardAfterPurge = await request(application, token, {
      method: "GET",
      url: "/api/dashboard",
    });
    const dashboard = JSON.parse(dashboardAfterPurge.body) as {
      memories: unknown[];
    };
    assert.equal(dashboard.memories.length, 0);
  } finally {
    setup.database.close();
  }
});

test("Continuity console reconciles candidates only with same-persona targets", async () => {
  const setup = fixture();
  const token = "r".repeat(32);
  const explicitUserAction = { actor: "user" as const, explicitUserAction: true };
  try {
    const target = setup.control.createMemory(
      {
        personaId: setup.skylar.persona.id,
        memoryClass: "durable",
        assertion: "Steve prefers direct answers.",
        type: "preference",
        normalizedAssertion: "direct answers",
      },
      explicitUserAction,
    );
    const otherPersonaTarget = setup.control.createMemory(
      {
        personaId: setup.advisor.persona.id,
        memoryClass: "durable",
        assertion: "Advisor-only memory.",
        type: "fact",
      },
      explicitUserAction,
    );
    const captured = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers concise, direct answers.",
    );
    const candidateId = captured.candidates[0]!.id;
    const application = createContinuityConsoleApplication(
      {
        behaviors: setup.behaviors,
        conversations: setup.conversations,
        control: setup.control,
        personaContext: setup.skylar,
      },
      token,
    );
    const headers = { "content-type": "application/json", origin };

    const missingTarget = await request(application, token, {
      method: "POST",
      url: `/api/candidates/${candidateId}/resolve`,
      headers,
      body: JSON.stringify({ outcome: "revise" }),
    });
    assert.equal(missingTarget.status, 400);

    const crossPersona = await request(application, token, {
      method: "POST",
      url: `/api/candidates/${candidateId}/resolve`,
      headers,
      body: JSON.stringify({
        outcome: "revise",
        targetMemoryId: otherPersonaTarget.memory.id,
      }),
    });
    assert.equal(crossPersona.status, 404);

    const crossPersonaPurgePreview = await request(application, token, {
      method: "GET",
      url: `/api/memories/${otherPersonaTarget.memory.id}/purge-preview`,
    });
    assert.equal(crossPersonaPurgePreview.status, 404);

    const resolvedResponse = await request(application, token, {
      method: "POST",
      url: `/api/candidates/${candidateId}/resolve`,
      headers,
      body: JSON.stringify({
        outcome: "revise",
        targetMemoryId: target.memory.id,
        note: "User selected the existing preference.",
      }),
    });
    assert.equal(resolvedResponse.status, 200);
    const resolved = JSON.parse(resolvedResponse.body) as {
      memory: { id: string; assertion: string; revisionNumber: number } | null;
      resolution: { outcome: string; targetMemoryId: string | null };
    };
    assert.equal(resolved.memory?.id, target.memory.id);
    assert.equal(resolved.memory?.assertion, "Steve prefers concise, direct answers.");
    assert.equal(resolved.memory?.revisionNumber, 2);
    assert.equal(resolved.resolution.outcome, "revise");
    assert.equal(resolved.resolution.targetMemoryId, target.memory.id);
  } finally {
    setup.database.close();
  }
});

test("Continuity console socket listener binds only to IPv4 loopback", async () => {
  const setup = fixture();
  try {
    const handle = await startContinuityConsole({
      behaviors: setup.behaviors,
      conversations: setup.conversations,
      control: setup.control,
      personaContext: setup.skylar,
      port: 0,
      token: "v".repeat(32),
    });
    try {
      assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
      assert.equal(handle.launchUrl, `${handle.origin}/#token=${"v".repeat(32)}`);
    } finally {
      await handle.close();
    }
  } finally {
    setup.database.close();
  }
});
