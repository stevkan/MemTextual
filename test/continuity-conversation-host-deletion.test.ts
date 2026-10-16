import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityConversationHostDeletionService,
  ExplicitConversationHostDeletionRequiredError,
  HostAuthorizationService,
  PersonaService,
  SqliteContinuityConversationRepository,
  SqliteHostEventRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
  openMemTextualDatabase,
  type DeletableConversationHost,
} from "../src/index.js";

class FakeDeletableHost implements DeletableConversationHost {
  readonly deleted: string[] = [];
  failure: Error | null = null;

  async deleteConversation(conversationId: string) {
    this.deleted.push(conversationId);
    if (this.failure !== null) throw this.failure;
    return { conversationId, deleted: true as const };
  }
}

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
  const authorization = new HostAuthorizationService(
    new SqliteHostEventRepository(database),
    personaRepository,
  ).authorize(
    {
      userId: user.id,
      personaId: skylar.persona.id,
      hostId: "test.deletable-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    { actor: "user", explicitUserAction: true },
  ).authorization;
  const repository = new SqliteContinuityConversationRepository(database);
  repository.createConversation({
    id: "conversation-1",
    userId: user.id,
    personaId: skylar.persona.id,
    relationshipId: skylar.relationship.id,
    authorizationId: authorization.id,
    hostId: "test.deletable-host",
    externalConversationId: "external-1",
    behaviorProfileId: null,
    behaviorProfileRevision: null,
  });
  repository.createTurnCapture({
    id: "capture-1",
    conversationId: "conversation-1",
    externalTurnId: "turn-1",
    externalEventId: "event-1",
    userText: "Hello.",
    assistantText: "Hello, Steve.",
    completedAt: "2026-10-16T12:00:00.000Z",
    contextFormatVersion: 1,
    memoryRevisionIds: [],
  });
  const host = new FakeDeletableHost();
  const left: string[] = [];
  const service = new ContinuityConversationHostDeletionService(
    repository,
    host,
    {
      leaveConversation: (conversationId, personaId) =>
        left.push(`${conversationId}:${personaId}`),
      now: () => new Date("2026-10-16T12:30:00.000Z"),
    },
  );
  return { advisor, database, host, left, repository, service, skylar };
}

test("previews and confirms provider deletion while retaining the local journal", async () => {
  const setup = fixture();
  try {
    const preview = setup.service.preview(
      "conversation-1",
      setup.skylar.persona.id,
    );
    assert.equal(preview.turnCount, 1);
    assert.equal(preview.unresolvedCaptureCount, 1);
    assert.equal(preview.localJournalWillRemain, true);
    assert.equal(preview.derivedMemoriesWillRemain, true);
    assert.equal(preview.snapshotsAndBackupsMayRemain, true);

    await assert.rejects(
      setup.service.deleteHostConversation({
        conversationId: "conversation-1",
        personaId: setup.skylar.persona.id,
        confirmation: preview.confirmation,
        acknowledgeLocalDataRemains: true,
        acknowledgeBackupsMayRemain: true,
      }),
      ExplicitConversationHostDeletionRequiredError,
    );

    const result = await setup.service.deleteHostConversation(
      {
        conversationId: "conversation-1",
        personaId: setup.skylar.persona.id,
        confirmation: preview.confirmation,
        acknowledgeLocalDataRemains: true,
        acknowledgeBackupsMayRemain: true,
      },
      { actor: "user", explicitUserAction: true },
    );
    assert.equal(result.status, "deleted");
    assert.equal(result.deletedAt, "2026-10-16T12:30:00.000Z");
    assert.deepEqual(setup.host.deleted, ["external-1"]);
    assert.deepEqual(setup.left, [
      `conversation-1:${setup.skylar.persona.id}`,
    ]);
    assert.equal(
      setup.repository.listConversationTurnCaptures(
        "conversation-1",
        setup.skylar.persona.id,
      ).length,
      1,
    );
  } finally {
    setup.database.close();
  }
});

test("fails closed across persona boundaries, stale previews, and host errors", async () => {
  const setup = fixture();
  try {
    assert.throws(
      () => setup.service.preview("conversation-1", setup.advisor.persona.id),
      /not found/u,
    );
    const stale = setup.service.preview(
      "conversation-1",
      setup.skylar.persona.id,
    );
    setup.repository.createTurnCapture({
      id: "capture-2",
      conversationId: "conversation-1",
      externalTurnId: "turn-2",
      externalEventId: "event-2",
      userText: "More.",
      assistantText: "More.",
      completedAt: "2026-10-16T12:10:00.000Z",
      contextFormatVersion: 1,
      memoryRevisionIds: [],
    });
    await assert.rejects(
      setup.service.deleteHostConversation(
        {
          conversationId: "conversation-1",
          personaId: setup.skylar.persona.id,
          confirmation: stale.confirmation,
          acknowledgeLocalDataRemains: true,
          acknowledgeBackupsMayRemain: true,
        },
        { actor: "user", explicitUserAction: true },
      ),
      /current host-deletion preview/u,
    );

    const current = setup.service.preview(
      "conversation-1",
      setup.skylar.persona.id,
    );
    setup.host.failure = new Error("provider unavailable");
    await assert.rejects(
      setup.service.deleteHostConversation(
        {
          conversationId: "conversation-1",
          personaId: setup.skylar.persona.id,
          confirmation: current.confirmation,
          acknowledgeLocalDataRemains: true,
          acknowledgeBackupsMayRemain: true,
        },
        { actor: "user", explicitUserAction: true },
      ),
      /provider unavailable/u,
    );
    assert.deepEqual(setup.repository.getHostDeletion("conversation-1"), {
      conversationId: "conversation-1",
      status: "failed",
      attemptCount: 1,
      lastAttemptAt: "2026-10-16T12:30:00.000Z",
      failureCode: "host_delete_failed",
      deletedAt: null,
      updatedAt: "2026-10-16T12:30:00.000Z",
    });
  } finally {
    setup.database.close();
  }
});
