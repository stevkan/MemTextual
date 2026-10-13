import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  IngestionService,
  PersonaService,
  ReviewAutomationService,
  SqliteContinuityMemoryRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  SqliteReviewPolicyRepository,
  openMemTextualDatabase,
  type AmbientMemoryExtractor,
} from "../src/index.js";

function fixture(extractor: AmbientMemoryExtractor, withAutomation = false) {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const ingestionRepository = new SqliteIngestionRepository(
    database,
    memoryRepository,
  );
  const personaRepository = new SqlitePersonaRepository(database);
  const policyRepository = new SqliteReviewPolicyRepository(
    database,
    ingestionRepository,
  );
  const automation = new ReviewAutomationService(
    ingestionRepository,
    policyRepository,
  );
  const ingestion = new IngestionService(
    ingestionRepository,
    withAutomation ? automation : undefined,
  );
  const personas = new PersonaService(personaRepository);
  const user = personas.createUser({ displayName: "Steve" });
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const ambient = new AmbientMemoryService(
    ingestion,
    personaRepository,
    extractor,
  );
  const continuity = new SqliteContinuityMemoryRepository(
    database,
    memoryRepository,
  );
  return {
    advisor,
    ambient,
    automation,
    continuity,
    database,
    ingestion,
    ingestionRepository,
    skylar,
    user,
  };
}

test("ambient capture creates pending, persona-isolated, idempotent candidates", () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.preference-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Steve prefers to be addressed as Mr. Steve.",
        type: "preference",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
    ],
  };
  const setup = fixture(extractor);
  const input = {
    personaId: setup.skylar.persona.id,
    source: {
      kind: "chat" as const,
      title: "Conversation with Skylar",
      externalId: "chat:skylar:1",
      records: [
        {
          kind: "message" as const,
          authorRole: "user",
          content: "Please call me Mr. Steve.",
        },
      ],
    },
  };

  try {
    const first = setup.ambient.captureInteraction(input);
    assert.equal(first.createdCandidateCount, 1);
    assert.equal(first.candidates[0]?.status, "pending");
    assert.equal(first.candidates[0]?.explicitness, "inferred");
    assert.equal(first.candidates[0]?.scopeId, setup.skylar.relationship.scopeId);
    assert.equal(setup.continuity.listForPersona(setup.skylar.persona.id).length, 0);
    assert.equal(setup.continuity.listForPersona(setup.advisor.persona.id).length, 0);

    const profile = setup.database
      .prepare(
        `SELECT persona_id, relationship_id, memory_class, extractor_version
         FROM ambient_candidate_profiles WHERE candidate_id = ?`,
      )
      .get(first.candidates[0]!.id) as {
      persona_id: string;
      relationship_id: string;
      memory_class: string;
      extractor_version: string;
    };
    assert.deepEqual(profile, {
      persona_id: setup.skylar.persona.id,
      relationship_id: setup.skylar.relationship.id,
      memory_class: "durable",
      extractor_version: "1",
    });

    const repeated = setup.ambient.captureInteraction(input);
    assert.equal(repeated.createdCandidateCount, 0);
    assert.equal(repeated.candidates[0]?.id, first.candidates[0]?.id);
    assert.equal(setup.ingestion.listCandidates().length, 1);

    const accepted = setup.ingestion.acceptCandidate(first.candidates[0]!.id, {
      actor: "user",
      explicitUserAction: true,
    });
    assert.equal(
      setup.continuity.getById(accepted.memory.id)?.personaId,
      setup.skylar.persona.id,
    );
    assert.equal(
      setup.continuity.getById(accepted.memory.id)?.memoryClass,
      "durable",
    );
    assert.equal(setup.continuity.listForPersona(setup.advisor.persona.id).length, 0);
  } finally {
    setup.database.close();
  }
});

test("an explicit user policy may accept eligible ambient candidates only", () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.trusted-extractor",
    version: "2",
    extract: ({ records }) => [
      {
        assertion: "Steve prefers concise answers.",
        type: "preference",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
        explicitness: "explicit",
        confidence: 1,
      },
      {
        assertion: "Steve discussed a sensitive personal detail.",
        type: "fact",
        memoryClass: "episodic",
        evidence: [{ sourceRecordId: records[1]!.id }],
        explicitness: "explicit",
        confidence: 1,
        sensitivity: "sensitive",
      },
    ],
  };
  const setup = fixture(extractor, true);
  try {
    setup.automation.setPolicy(
      {
        name: "Trusted ambient extractor",
        mode: "risk_based",
        scopeId: setup.skylar.relationship.scopeId,
        conditions: {
          trustedProposerIds: [extractor.id],
          minimumConfidence: 1,
        },
      },
      { actor: "user", explicitUserAction: true },
    );

    const result = setup.ambient.captureInteraction({
      personaId: setup.skylar.persona.id,
      source: {
        kind: "chat",
        title: "Policy capture",
        externalId: "chat:skylar:policy",
        records: [
          {
            kind: "message",
            authorRole: "user",
            content: "Keep your answers concise.",
          },
          {
            kind: "message",
            authorRole: "user",
            content: "A sensitive detail.",
          },
        ],
      },
    });

    assert.deepEqual(
      result.candidates.map(({ status }) => status),
      ["accepted", "pending"],
    );
    const acceptedMemoryId = result.candidates[0]!.acceptedMemoryId;
    assert.notEqual(acceptedMemoryId, null);
    const profile = setup.continuity.getById(acceptedMemoryId!);
    assert.equal(profile?.personaId, setup.skylar.persona.id);
    assert.equal(profile?.memoryClass, "durable");
    assert.equal(setup.continuity.listForPersona(setup.advisor.persona.id).length, 0);
  } finally {
    setup.database.close();
  }
});

test("ambient capture rejects evidence outside the captured interaction", () => {
  let foreignRecordId = "";
  const extractor: AmbientMemoryExtractor = {
    id: "test.invalid-evidence",
    version: "1",
    extract: () => [
      {
        assertion: "Invalid proposal",
        type: "fact",
        memoryClass: "episodic",
        evidence: [{ sourceRecordId: foreignRecordId }],
      },
    ],
  };
  const setup = fixture(extractor);
  try {
    const other = setup.ingestion.importSource({
      kind: "chat",
      title: "Other interaction",
      records: [{ kind: "message", content: "Other evidence" }],
    });
    foreignRecordId = other.records[0]!.id;
    assert.throws(
      () =>
        setup.ambient.captureInteraction({
          personaId: setup.skylar.persona.id,
          source: {
            kind: "chat",
            title: "Captured interaction",
            records: [{ kind: "message", content: "Current evidence" }],
          },
        }),
      /must reference the captured interaction/u,
    );
    assert.equal(setup.ingestion.listCandidates().length, 0);
  } finally {
    setup.database.close();
  }
});

test("database invariants reject ambient candidates bound to another persona scope", () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.noop",
    version: "1",
    extract: () => [],
  };
  const setup = fixture(extractor);
  try {
    const imported = setup.ingestion.importSource({
      kind: "chat",
      title: "Invariant source",
      records: [{ kind: "message", content: "Evidence" }],
    });
    assert.throws(
      () =>
        setup.ingestionRepository.proposeCandidate({
          assertion: "Wrongly scoped ambient candidate",
          type: "fact",
          scopeId: setup.skylar.relationship.scopeId,
          evidence: [{ sourceRecordId: imported.records[0]!.id }],
          proposedBy: "extractor",
          proposerId: extractor.id,
          ambientContext: {
            sourceId: imported.source.id,
            userId: setup.user.id,
            personaId: setup.advisor.persona.id,
            relationshipId: setup.advisor.relationship.id,
            memoryClass: "durable",
            extractorId: extractor.id,
            extractorVersion: extractor.version,
          },
        }),
      /relationship scope/u,
    );
    assert.equal(setup.ingestion.listCandidates().length, 0);
  } finally {
    setup.database.close();
  }
});
