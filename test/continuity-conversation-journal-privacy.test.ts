import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityConversationJournalPrivacyService,
  HostAuthorizationService,
  IngestionService,
  PersonaService,
  SqliteContinuityConversationJournalPrivacyRepository,
  SqliteContinuityConversationRepository,
  SqliteHostEventRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
  openMemTextualDatabase,
} from "../src/index.js";

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

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
  const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
  const hostEvents = new SqliteHostEventRepository(database);
  const authorization = new HostAuthorizationService(
    hostEvents,
    personaRepository,
  ).authorize(
    {
      userId: user.id,
      personaId: persona.persona.id,
      hostId: "test.conversation-host",
      allowedEventKinds: [continuityConversationTurnEventKind],
    },
    explicitUserAction,
  ).authorization;
  const conversations = new SqliteContinuityConversationRepository(database);
  const conversation = conversations.createConversation({
    id: "conversation-1",
    userId: user.id,
    personaId: persona.persona.id,
    relationshipId: persona.relationship.id,
    authorizationId: authorization.id,
    hostId: authorization.hostId,
    externalConversationId: "external-conversation-1",
    behaviorProfileId: null,
    behaviorProfileRevision: null,
  });
  const privacyRepository =
    new SqliteContinuityConversationJournalPrivacyRepository(database);
  const privacy = new ContinuityConversationJournalPrivacyService(
    privacyRepository,
    { now: () => new Date("2026-10-16T12:00:00.000Z") },
  );

  const addCapturedTurn = (number: number) => {
    const externalEventId = `event-${number}`;
    const capture = conversations.createTurnCapture({
      id: `capture-${number}`,
      conversationId: conversation.id,
      externalTurnId: `turn-${number}`,
      externalEventId,
      userText: `Private user text ${number}.`,
      assistantText: `Private assistant text ${number}.`,
      completedAt: `2026-10-16T10:0${number}:00.000Z`,
      contextFormatVersion: 1,
      memoryRevisionIds: [],
    });
    const imported = ingestion.importSource({
      kind: "chat",
      title: `Captured conversation turn ${number}`,
      externalId: `continuity-host:${authorization.id}:${externalEventId}`,
      records: [
        {
          kind: "message",
          authorRole: "user",
          content: capture.userText,
        },
        {
          kind: "message",
          authorRole: "assistant",
          content: capture.assistantText,
        },
      ],
    });
    const candidate = ingestion.proposeCandidate({
      assertion: `Candidate from turn ${number}.`,
      type: "fact",
      scopeId: persona.relationship.scopeId,
      evidence: [{ sourceRecordId: imported.records[0]!.id }],
      proposedBy: "system",
    });
    const receipt = hostEvents.recordEvent({
      id: `receipt-${number}`,
      authorizationId: authorization.id,
      externalEventId,
      eventKind: continuityConversationTurnEventKind,
      hostId: authorization.hostId,
      hostVersion: "1",
      personaId: persona.persona.id,
      relationshipId: persona.relationship.id,
      payloadHash: String(number).padStart(64, "0"),
      sourceId: imported.source.id,
      candidateIds: [],
    });
    conversations.markTurnCaptureCaptured(
      capture.id,
      `2026-10-16T10:1${number}:00.000Z`,
      receipt.id,
    );
    return { candidate, capture, imported, receipt };
  };

  const confirmHostDeletion = () => {
    const attemptedAt = "2026-10-16T11:00:00.000Z";
    conversations.beginHostDeletion(conversation.id, attemptedAt);
    conversations.markHostDeleted(conversation.id, attemptedAt);
  };

  return {
    addCapturedTurn,
    confirmHostDeletion,
    conversation,
    conversations,
    database,
    ingestion,
    memoryRepository,
    persona,
    privacy,
    privacyRepository,
  };
}

test("conversation journal purge removes owned active-database copies and keeps an immutable receipt", () => {
  const setup = fixture();
  try {
    const first = setup.addCapturedTurn(1);
    const second = setup.addCapturedTurn(2);
    setup.confirmHostDeletion();

    assert.throws(
      () =>
        setup.database
          .prepare("DELETE FROM continuity_conversation_turn_captures WHERE id = ?")
          .run(first.capture.id),
      /require a purge receipt/u,
    );

    const preview = setup.privacy.preview(
      setup.conversation.id,
      setup.persona.persona.id,
    );
    assert.deepEqual(
      {
        canPurge: preview.canPurge,
        turnCount: preview.turnCount,
        hostEventCount: preview.hostEventCount,
        sourceSeriesCount: preview.sourceSeriesCount,
        sourceRecordCount: preview.sourceRecordCount,
        candidateCount: preview.candidateCount,
      },
      {
        canPurge: true,
        turnCount: 2,
        hostEventCount: 2,
        sourceSeriesCount: 2,
        sourceRecordCount: 4,
        candidateCount: 2,
      },
    );
    assert.equal(preview.externalCopiesNotModified, true);
    assert.equal(preview.snapshotsAndBackupsMayRemain, true);
    assert.throws(
      () =>
        setup.privacy.purge({
          conversationId: setup.conversation.id,
          personaId: setup.persona.persona.id,
          reason: "User requested removal.",
          confirmation: preview.confirmation,
          acknowledgePermanentActiveDatabaseDeletion: true,
          acknowledgeExternalCopiesMayRemain: true,
        }),
      /explicit user action/u,
    );

    const receipt = setup.privacy.purge(
      {
        conversationId: setup.conversation.id,
        personaId: setup.persona.persona.id,
        reason: "User requested removal.",
        confirmation: preview.confirmation,
        acknowledgePermanentActiveDatabaseDeletion: true,
        acknowledgeExternalCopiesMayRemain: true,
      },
      explicitUserAction,
    );
    assert.equal(receipt.externalCopiesNotModified, true);
    assert.equal(receipt.deletedRowCounts.conversationTurnCaptures, 2);
    assert.equal(receipt.deletedRowCounts.hostEvents, 2);
    assert.equal(receipt.deletedRowCounts.sourceRecords, 4);
    assert.equal(receipt.deletedRowCounts.memoryCandidates, 2);
    assert.equal(setup.ingestion.getCandidate(first.candidate.id), null);
    assert.equal(setup.ingestion.getCandidate(second.candidate.id), null);
    assert.equal(
      setup.database.prepare("SELECT 1 FROM sources WHERE id = ?").get(first.imported.source.id),
      undefined,
    );
    assert.equal(
      setup.database.prepare("SELECT 1 FROM continuity_host_events WHERE id = ?").get(first.receipt.id),
      undefined,
    );
    assert.deepEqual(
      setup.conversations.listConversationTurnCaptures(
        setup.conversation.id,
        setup.persona.persona.id,
      ),
      [],
    );
    const summary = setup.conversations.listConversations(
      setup.persona.persona.id,
    )[0]!;
    assert.equal(summary.turnCount, 0);
    assert.deepEqual(summary.journalPurge, receipt);
    assert.throws(
      () =>
        setup.database
          .prepare("DELETE FROM continuity_conversation_journal_purge_receipts WHERE id = ?")
          .run(receipt.receiptId),
      /cannot be deleted/u,
    );
    assert.throws(
      () =>
        setup.conversations.createTurnCapture({
          id: "capture-after-purge",
          conversationId: setup.conversation.id,
          externalTurnId: "turn-after-purge",
          externalEventId: "event-after-purge",
          userText: "This must not be stored.",
          assistantText: "This must not be stored.",
          completedAt: "2026-10-16T13:00:00.000Z",
          contextFormatVersion: 1,
          memoryRevisionIds: [],
        }),
      /cannot accept new captures/u,
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("conversation journal purge is persona-bound and waits for confirmed host deletion", () => {
  const setup = fixture();
  try {
    setup.addCapturedTurn(1);
    const blocked = setup.privacy.preview(
      setup.conversation.id,
      setup.persona.persona.id,
    );
    assert.equal(blocked.canPurge, false);
    assert.match(blocked.blockers.join(" "), /provider-confirmed deletion/u);
    assert.throws(
      () => setup.privacy.preview(setup.conversation.id, "another-persona"),
      /not found/u,
    );
  } finally {
    setup.database.close();
  }
});

test("retained memory evidence blocks conversation journal purge", () => {
  const setup = fixture();
  try {
    const captured = setup.addCapturedTurn(1);
    const accepted = setup.ingestion.acceptCandidate(
      captured.candidate.id,
      explicitUserAction,
    );
    setup.confirmHostDeletion();

    const preview = setup.privacy.preview(
      setup.conversation.id,
      setup.persona.persona.id,
    );
    assert.equal(preview.canPurge, false);
    assert.deepEqual(preview.dependentMemoryIds, [accepted.memory.id]);
    assert.match(preview.blockers.join(" "), /Retained memories/u);
    assert.throws(
      () =>
        setup.privacy.purge(
          {
            conversationId: setup.conversation.id,
            personaId: setup.persona.persona.id,
            reason: "Should remain blocked.",
            confirmation: preview.confirmation,
            acknowledgePermanentActiveDatabaseDeletion: true,
            acknowledgeExternalCopiesMayRemain: true,
          },
          explicitUserAction,
        ),
      /cannot be purged/u,
    );
    assert.notEqual(
      setup.database
        .prepare("SELECT 1 FROM continuity_conversation_turn_captures WHERE id = ?")
        .get(captured.capture.id),
      undefined,
    );
  } finally {
    setup.database.close();
  }
});

test("conversation journal purge rejects a stale preview without mutation", () => {
  const setup = fixture();
  try {
    setup.addCapturedTurn(1);
    setup.confirmHostDeletion();
    const impact = setup.privacyRepository.previewJournalPurge(
      setup.conversation.id,
      setup.persona.persona.id,
    );
    setup.addCapturedTurn(2);

    assert.throws(
      () =>
        setup.privacyRepository.purgeJournal({
          conversationId: setup.conversation.id,
          personaId: setup.persona.persona.id,
          reason: "Stale request.",
          expectedFingerprint: impact.fingerprint,
          receiptId: "stale-receipt",
          purgedAt: "2026-10-16T12:00:00.000Z",
        }),
      /preview is stale/u,
    );
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM continuity_conversation_turn_captures")
          .get() as { count: number }
      ).count,
      2,
    );
    assert.equal(
      setup.privacyRepository.getJournalPurgeReceipt(setup.conversation.id),
      null,
    );
  } finally {
    setup.database.close();
  }
});
