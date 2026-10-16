import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityConversationCatalogService,
  HostAuthorizationService,
  PersonaService,
  SqliteContinuityConversationRepository,
  SqliteHostEventRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const personaRepository = new SqlitePersonaRepository(database);
  const personas = new PersonaService(personaRepository);
  const user = personas.createUser({ displayName: "Steve" });
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const authorizations = new HostAuthorizationService(
    new SqliteHostEventRepository(database),
    personaRepository,
  );
  const skylarAuthorization = authorizations.authorize(
    {
      userId: user.id,
      personaId: skylar.persona.id,
      hostId: "test.conversation-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  );
  const advisorAuthorization = authorizations.authorize(
    {
      userId: user.id,
      personaId: advisor.persona.id,
      hostId: "test.conversation-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  );
  const repository = new SqliteContinuityConversationRepository(database);
  const catalog = new ContinuityConversationCatalogService(
    repository,
    personaRepository,
  );
  return {
    advisor,
    advisorAuthorization,
    catalog,
    database,
    repository,
    skylar,
    skylarAuthorization,
    user,
  };
}

function createConversation(
  setup: ReturnType<typeof fixture>,
  input: {
    id: string;
    externalId: string;
    persona: ReturnType<typeof fixture>["skylar"];
    authorizationId: string;
  },
) {
  return setup.repository.createConversation({
    id: input.id,
    userId: setup.user.id,
    personaId: input.persona.persona.id,
    relationshipId: input.persona.relationship.id,
    authorizationId: input.authorizationId,
    hostId: "test.conversation-host",
    externalConversationId: input.externalId,
    behaviorProfileId: null,
    behaviorProfileRevision: null,
  });
}

test("catalog lists persona conversations with local recovery summaries", () => {
  const setup = fixture();
  try {
    createConversation(setup, {
      id: "skylar-empty",
      externalId: "external-empty",
      persona: setup.skylar,
      authorizationId: setup.skylarAuthorization.authorization.id,
    });
    createConversation(setup, {
      id: "skylar-active",
      externalId: "external-active",
      persona: setup.skylar,
      authorizationId: setup.skylarAuthorization.authorization.id,
    });
    createConversation(setup, {
      id: "advisor-only",
      externalId: "external-advisor",
      persona: setup.advisor,
      authorizationId: setup.advisorAuthorization.authorization.id,
    });
    setup.repository.createTurnCapture({
      id: "capture-1",
      conversationId: "skylar-active",
      externalTurnId: "turn-1",
      externalEventId: "event-1",
      userText: "Hello, Skylar.",
      assistantText: "Hello, Steve.",
      completedAt: "2126-10-15T17:00:00.000Z",
      contextFormatVersion: 1,
      memoryRevisionIds: [],
    });
    setup.repository.createTurnCapture({
      id: "capture-2",
      conversationId: "skylar-active",
      externalTurnId: "turn-2",
      externalEventId: "event-2",
      userText: "Remember this preference.",
      assistantText: "I understand.",
      completedAt: "2126-10-15T17:01:00.000Z",
      contextFormatVersion: 1,
      memoryRevisionIds: ["revision-1"],
    });
    setup.repository.markTurnCaptureFailed(
      "capture-2",
      "2126-10-15T17:01:01.000Z",
      "ambient_capture_failed",
    );

    const summaries = setup.catalog.listConversations(setup.skylar.persona.id);
    assert.deepEqual(
      summaries.map(({ conversation, turnCount, unresolvedCaptureCount }) => ({
        id: conversation.id,
        turnCount,
        unresolvedCaptureCount,
      })),
      [
        { id: "skylar-active", turnCount: 2, unresolvedCaptureCount: 2 },
        { id: "skylar-empty", turnCount: 0, unresolvedCaptureCount: 0 },
      ],
    );
    assert.equal(summaries[0]?.lastActivityAt, "2126-10-15T17:01:00.000Z");
    assert.equal(
      setup.catalog.listConversations(setup.advisor.persona.id)[0]?.conversation.id,
      "advisor-only",
    );
  } finally {
    setup.database.close();
  }
});

test("catalog returns exact journaled dialogue only within the selected persona", () => {
  const setup = fixture();
  try {
    createConversation(setup, {
      id: "skylar-conversation",
      externalId: "external-skylar",
      persona: setup.skylar,
      authorizationId: setup.skylarAuthorization.authorization.id,
    });
    setup.repository.createTurnCapture({
      id: "capture-exact",
      conversationId: "skylar-conversation",
      externalTurnId: "turn-exact",
      externalEventId: "event-exact",
      userText: "Exact user text.\nSecond line.",
      assistantText: "Exact assistant text.",
      completedAt: "2026-10-15T18:00:00.000Z",
      contextFormatVersion: 1,
      memoryRevisionIds: [],
    });

    const detail = setup.catalog.getConversation(
      "skylar-conversation",
      setup.skylar.persona.id,
    );
    assert.equal(detail.turns[0]?.userText, "Exact user text.\nSecond line.");
    assert.equal(detail.turns[0]?.assistantText, "Exact assistant text.");
    assert.equal(detail.summary.unresolvedCaptureCount, 1);
    assert.throws(
      () =>
        setup.catalog.getConversation(
          "skylar-conversation",
          setup.advisor.persona.id,
        ),
      /conversation not found/u,
    );
  } finally {
    setup.database.close();
  }
});

