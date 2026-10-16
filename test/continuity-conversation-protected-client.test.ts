import assert from "node:assert/strict";
import test from "node:test";
import {
  ContinuityConversationProtectedClient,
  type ContinuityConversation,
  type ContinuityConversationProtectedGrantResolver,
  type ContinuityConversationProtectedLifecycle,
  type ContinuityConversationReconciliationResult,
  type ContinuityConversationTurnResult,
  type HostAuthorization,
  type PersonaContext,
} from "../src/index.js";

const persona: PersonaContext = {
  persona: {
    id: "persona-1",
    userId: "user-1",
    name: "Skylar",
    externalId: null,
    description: null,
    scopeId: "scope-persona",
    metadata: {},
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
  },
  relationship: {
    id: "relationship-1",
    userId: "user-1",
    personaId: "persona-1",
    name: "Default",
    scopeId: "scope-relationship",
    metadata: {},
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
  },
};

const authorization: HostAuthorization = {
  id: "authorization-1",
  userId: persona.persona.userId,
  personaId: persona.persona.id,
  relationshipId: persona.relationship.id,
  hostId: "codex.app-server",
  allowedEventKinds: ["conversation.turn.completed"],
  status: "active",
  expiresAt: null,
  authorizedAt: "2026-10-15T12:00:00.000Z",
  revokedAt: null,
};

const conversation: ContinuityConversation = {
  id: "conversation-1",
  userId: persona.persona.userId,
  personaId: persona.persona.id,
  relationshipId: persona.relationship.id,
  authorizationId: authorization.id,
  hostId: authorization.hostId,
  externalConversationId: "external-1",
  behaviorProfileId: null,
  behaviorProfileRevision: null,
  createdAt: "2026-10-15T12:00:00.000Z",
};

const grant = `mthg_${"g".repeat(43)}`;
const reconciliation: ContinuityConversationReconciliationResult = {
  conversation,
  hostTurnCount: 0,
  existingCaptureCount: 0,
  recovered: [],
};

class FakeGrantResolver implements ContinuityConversationProtectedGrantResolver {
  readonly calls: string[] = [];
  resolvedAuthorization = authorization;
  value = grant;

  async resolveForPersonaAuthorization(
    authorizationId: string,
    selectedPersona: PersonaContext,
  ) {
    this.calls.push(`authorization:${authorizationId}:${selectedPersona.persona.id}`);
    return { authorization: this.resolvedAuthorization, grant: this.value };
  }

  async resolveForConversation(selected: ContinuityConversation) {
    this.calls.push(`conversation:${selected.id}`);
    return this.value;
  }
}

class FakeLifecycle implements ContinuityConversationProtectedLifecycle {
  readonly calls: Array<{ operation: string; input: unknown }> = [];

  async startConversation(input: Parameters<ContinuityConversationProtectedLifecycle["startConversation"]>[0]) {
    this.calls.push({ operation: "start", input });
    return conversation;
  }

  async openConversation(input: Parameters<ContinuityConversationProtectedLifecycle["openConversation"]>[0]) {
    this.calls.push({ operation: "open", input });
    return { conversation, reconciliation };
  }

  async sendTurn(input: Parameters<ContinuityConversationProtectedLifecycle["sendTurn"]>[0]) {
    this.calls.push({ operation: "send", input });
    return { conversation } as ContinuityConversationTurnResult;
  }

  leaveConversation(conversationId: string, personaId: string): void {
    this.calls.push({ operation: "leave", input: { conversationId, personaId } });
  }
}

function fixture() {
  const grants = new FakeGrantResolver();
  const lifecycle = new FakeLifecycle();
  const client = new ContinuityConversationProtectedClient({
    authorizations: grants,
    conversations: {
      getConversation: (id) => (id === conversation.id ? conversation : null),
    },
    lifecycle,
    personas: {
      getPersonaContext: (id) => (id === persona.persona.id ? persona : null),
    },
  });
  return { client, grants, lifecycle };
}

test("protected client resolves start authorization without a public grant input", async () => {
  const setup = fixture();
  const result = await setup.client.startConversation({
    personaId: persona.persona.id,
    authorizationId: authorization.id,
    model: "test-model",
  });
  assert.equal(result, conversation);
  assert.deepEqual(setup.grants.calls, [
    "authorization:authorization-1:persona-1",
  ]);
  assert.deepEqual(setup.lifecycle.calls, [
    {
      operation: "start",
      input: {
        personaId: persona.persona.id,
        authorizationId: authorization.id,
        grant,
        model: "test-model",
      },
    },
  ]);
});

test("protected client resolves a stored grant internally for open and send", async () => {
  const setup = fixture();
  assert.deepEqual(
    await setup.client.openConversation({
      conversationId: conversation.id,
      personaId: persona.persona.id,
    }),
    { conversation, reconciliation },
  );
  const result = await setup.client.sendTurn({
    conversationId: conversation.id,
    personaId: persona.persona.id,
    text: "Remember this turn.",
  });
  assert.equal(result.conversation, conversation);
  assert.deepEqual(setup.grants.calls, [
    "conversation:conversation-1",
    "conversation:conversation-1",
  ]);
  assert.deepEqual(
    setup.lifecycle.calls.map(({ operation, input }) => ({ operation, input })),
    [
      {
        operation: "open",
        input: {
          conversationId: conversation.id,
          personaId: persona.persona.id,
          grant,
        },
      },
      {
        operation: "send",
        input: {
          conversationId: conversation.id,
          personaId: persona.persona.id,
          grant,
          text: "Remember this turn.",
        },
      },
    ],
  );
});

test("protected client denies cross-persona IDs before grant resolution", async () => {
  const setup = fixture();
  await assert.rejects(
    setup.client.openConversation({
      conversationId: conversation.id,
      personaId: "other-persona",
    }),
    /conversation not found/u,
  );
  await assert.rejects(
    setup.client.sendTurn({
      conversationId: conversation.id,
      personaId: "other-persona",
      text: "Do not send this.",
    }),
    /conversation not found/u,
  );
  assert.deepEqual(setup.grants.calls, []);
  assert.deepEqual(setup.lifecycle.calls, []);
});

test("protected client fails closed on mismatched authorization or grant output", async () => {
  const setup = fixture();
  setup.grants.resolvedAuthorization = {
    ...authorization,
    personaId: "other-persona",
  };
  await assert.rejects(
    setup.client.startConversation({
      personaId: persona.persona.id,
      authorizationId: authorization.id,
    }),
    /crossed its binding/u,
  );
  setup.grants.resolvedAuthorization = authorization;
  setup.grants.value = "invalid-grant";
  await assert.rejects(
    setup.client.openConversation({
      conversationId: conversation.id,
      personaId: persona.persona.id,
    }),
    /grant is invalid/u,
  );
  assert.deepEqual(setup.lifecycle.calls, []);
});

test("protected client fails closed when lifecycle output crosses a stored binding", async () => {
  const setup = fixture();
  setup.lifecycle.startConversation = async (input) => {
    setup.lifecycle.calls.push({ operation: "start", input });
    return { ...conversation, hostId: "other-host" };
  };
  await assert.rejects(
    setup.client.startConversation({
      personaId: persona.persona.id,
      authorizationId: authorization.id,
    }),
    /outside its authorization binding/u,
  );

  setup.lifecycle.openConversation = async (input) => {
    setup.lifecycle.calls.push({ operation: "open", input });
    const mismatchedConversation = {
      ...conversation,
      externalConversationId: "other-external-conversation",
    };
    return {
      conversation: mismatchedConversation,
      reconciliation: { ...reconciliation, conversation: mismatchedConversation },
    };
  };
  await assert.rejects(
    setup.client.openConversation({
      conversationId: conversation.id,
      personaId: persona.persona.id,
    }),
    /unexpected conversation binding/u,
  );
});

test("protected client validates leave against the stored persona binding", () => {
  const setup = fixture();
  setup.client.leaveConversation(conversation.id, persona.persona.id);
  assert.deepEqual(setup.lifecycle.calls, [
    {
      operation: "leave",
      input: {
        conversationId: conversation.id,
        personaId: persona.persona.id,
      },
    },
  ]);
  assert.throws(
    () => setup.client.leaveConversation(conversation.id, "other-persona"),
    /conversation not found/u,
  );
});
