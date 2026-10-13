import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  AuthorizedHostEventCaptureService,
  HostAuthorizationService,
  IngestionService,
  PersonaService,
  SqliteHostEventRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  StructuredAmbientMemoryExtractor,
  openMemTextualDatabase,
  type AmbientExtractionProvider,
  type HostEventAdapter,
} from "../src/index.js";

function fixture(provider: AmbientExtractionProvider) {
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
  const hostRepository = new SqliteHostEventRepository(database);
  const authorizations = new HostAuthorizationService(
    hostRepository,
    personaRepository,
  );
  const ambient = new AmbientMemoryService(
    ingestion,
    personaRepository,
    new StructuredAmbientMemoryExtractor(provider),
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
  const adapter: HostEventAdapter<{ text: string }> = {
    hostId: "test.chat-host",
    version: "1",
    toSource: async ({ event }) => ({
      kind: "chat",
      title: "Authorized host event",
      records: [
        {
          kind: "message",
          authorRole: "user",
          content: event.payload.text,
          ...(event.occurredAt === undefined
            ? {}
            : { occurredAt: event.occurredAt }),
        },
      ],
    }),
  };
  const capture = new AuthorizedHostEventCaptureService(
    hostRepository,
    personaRepository,
    ambient,
    adapter,
  );
  return {
    adapter,
    advisor,
    authorizations,
    capture,
    database,
    ingestion,
    skylar,
    user,
  };
}

const validProvider: AmbientExtractionProvider = {
  id: "test.structured-provider",
  version: "1",
  extract: async ({ records }) =>
    JSON.stringify({
      proposals: [
        {
          assertion: "Steve prefers concise answers.",
          type: "preference",
          memoryClass: "durable",
          evidence: [{ sourceRecordId: records[0]!.id }],
          explicitness: "explicit",
          confidence: 1,
        },
      ],
    }),
};

test("authorized host capture validates provider output and records an idempotent receipt", async () => {
  const setup = fixture(validProvider);
  try {
    const issued = setup.authorizations.authorize(
      {
        userId: setup.user.id,
        personaId: setup.skylar.persona.id,
        hostId: setup.adapter.hostId,
        allowedEventKinds: ["message.completed"],
      },
      { actor: "user", explicitUserAction: true },
    );
    const credential = setup.database
      .prepare(
        `SELECT grant_hash FROM continuity_host_authorizations WHERE id = ?`,
      )
      .get(issued.authorization.id) as { grant_hash: string };
    assert.notEqual(credential.grant_hash, issued.grant);
    assert.equal(credential.grant_hash.length, 64);

    const input = {
      authorizationId: issued.authorization.id,
      grant: issued.grant,
      personaId: setup.skylar.persona.id,
      event: {
        id: "event-001",
        kind: "message.completed",
        occurredAt: "2026-10-13T09:00:00-07:00",
        payload: { text: "Please keep answers concise." },
      },
    };
    const captured = await setup.capture.capture(input);
    assert.equal(captured.reused, false);
    assert.equal(captured.createdCandidateCount, 1);
    assert.equal(captured.receipt.candidateIds.length, 1);
    assert.equal(captured.receipt.hostId, setup.adapter.hostId);
    assert.equal(captured.receipt.personaId, setup.skylar.persona.id);
    assert.equal(setup.ingestion.listSources().length, 1);
    assert.equal(setup.ingestion.listCandidates().length, 1);
    assert.equal(setup.ingestion.listCandidates()[0]?.status, "pending");
    assert.equal(setup.ingestion.listCandidates()[0]?.sensitivity, "normal");

    const repeated = await setup.capture.capture(input);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.createdCandidateCount, 0);
    assert.equal(repeated.receipt.id, captured.receipt.id);
    assert.equal(setup.ingestion.listSources().length, 1);
    assert.equal(setup.ingestion.listCandidates().length, 1);

    await assert.rejects(
      setup.capture.capture({
        ...input,
        event: {
          ...input.event,
          payload: { text: "Changed content under the same event ID." },
        },
      }),
      /cannot be reused with different content/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            "UPDATE continuity_host_events SET event_kind = ? WHERE id = ?",
          )
          .run("message.changed", captured.receipt.id),
      /receipt cannot be changed/u,
    );
    setup.authorizations.revoke(issued.authorization.id, {
      actor: "user",
      explicitUserAction: true,
    });
    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO continuity_host_events (
               id, authorization_id, external_event_id, event_kind, host_id,
               host_version, persona_id, relationship_id, payload_hash,
               source_id, candidate_ids_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "forged-receipt",
            issued.authorization.id,
            "event-after-revocation",
            "message.completed",
            setup.adapter.hostId,
            setup.adapter.version,
            setup.skylar.persona.id,
            setup.skylar.relationship.id,
            "0".repeat(64),
            captured.receipt.sourceId,
            JSON.stringify(captured.receipt.candidateIds),
          ),
      /not covered by an active authorization/u,
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("host capture requires an explicit persona-scoped grant and stops after revocation", async () => {
  const setup = fixture(validProvider);
  try {
    assert.throws(
      () =>
        setup.authorizations.authorize({
          userId: setup.user.id,
          personaId: setup.skylar.persona.id,
          hostId: setup.adapter.hostId,
          allowedEventKinds: ["message.completed"],
        }),
      /explicit user action/u,
    );
    const issued = setup.authorizations.authorize(
      {
        userId: setup.user.id,
        personaId: setup.skylar.persona.id,
        hostId: setup.adapter.hostId,
        allowedEventKinds: ["message.completed"],
      },
      { actor: "user", explicitUserAction: true },
    );
    const event = {
      id: "event-002",
      kind: "message.completed",
      payload: { text: "A host event." },
    };
    await assert.rejects(
      setup.capture.capture({
        authorizationId: issued.authorization.id,
        grant: "wrong-grant",
        personaId: setup.skylar.persona.id,
        event,
      }),
      /authorization was rejected/u,
    );
    await assert.rejects(
      setup.capture.capture({
        authorizationId: issued.authorization.id,
        grant: issued.grant,
        personaId: setup.advisor.persona.id,
        event,
      }),
      /authorization was rejected/u,
    );
    await assert.rejects(
      setup.capture.capture({
        authorizationId: issued.authorization.id,
        grant: issued.grant,
        personaId: setup.skylar.persona.id,
        event: { ...event, kind: "message.deleted" },
      }),
      /authorization was rejected/u,
    );
    assert.equal(setup.ingestion.listSources().length, 0);

    const revoked = setup.authorizations.revoke(issued.authorization.id, {
      actor: "user",
      explicitUserAction: true,
    });
    assert.equal(revoked.status, "revoked");
    await assert.rejects(
      setup.capture.capture({
        authorizationId: issued.authorization.id,
        grant: issued.grant,
        personaId: setup.skylar.persona.id,
        event,
      }),
      /authorization was rejected/u,
    );
    assert.equal(setup.ingestion.listSources().length, 0);
  } finally {
    setup.database.close();
  }
});

test("structured extraction rejects malformed provider output before candidate creation", async () => {
  const setup = fixture({
    id: "test.invalid-provider",
    version: "1",
    extract: async ({ records }) => ({
      proposals: [
        {
          assertion: "Invalid extra field.",
          type: "fact",
          memoryClass: "episodic",
          evidence: [{ sourceRecordId: records[0]!.id }],
          unexpected: true,
        },
      ],
    }),
  });
  try {
    await assert.rejects(
      setup.capture.capture({
        authorizationId: "missing-authorization",
        grant: "missing-grant",
        personaId: setup.skylar.persona.id,
        event: {
          id: "event-invalid",
          kind: "message.completed",
          payload: { text: "Invalid extraction." },
        },
      }),
      /authorization was rejected/u,
    );

    const issued = setup.authorizations.authorize(
      {
        userId: setup.user.id,
        personaId: setup.skylar.persona.id,
        hostId: setup.adapter.hostId,
        allowedEventKinds: ["message.completed"],
      },
      { actor: "user", explicitUserAction: true },
    );
    await assert.rejects(
      setup.capture.capture({
        authorizationId: issued.authorization.id,
        grant: issued.grant,
        personaId: setup.skylar.persona.id,
        event: {
          id: "event-invalid",
          kind: "message.completed",
          payload: { text: "Invalid extraction." },
        },
      }),
      /output failed validation/u,
    );
    assert.equal(setup.ingestion.listCandidates().length, 0);
    assert.equal(
      (
        setup.database
          .prepare("SELECT count(*) AS count FROM continuity_host_events")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    setup.database.close();
  }
});
