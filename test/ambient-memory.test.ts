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
  type AmbientSensitivityClassifier,
} from "../src/index.js";

const normalClassifier: AmbientSensitivityClassifier = {
  id: "test.normal-sensitivity",
  version: "1",
  classify: () => ({
    sensitivity: "normal",
    confidence: 1,
    reasonCodes: ["no_sensitive_signal"],
  }),
};

function fixture(
  extractor: AmbientMemoryExtractor,
  withAutomation = false,
  sensitivityClassifier?: AmbientSensitivityClassifier,
) {
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
    sensitivityClassifier,
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

test("ambient capture creates pending, persona-isolated, idempotent candidates", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.preference-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Steve prefers to be addressed as Mr. Steve.",
        type: "preference",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
        validFrom: "2026-10-01T00:00:00-07:00",
        reviewAfter: "2026-10-10T00:00:00-07:00",
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
    const first = await setup.ambient.captureInteraction(input);
    assert.equal(first.createdCandidateCount, 1);
    assert.equal(first.candidates[0]?.status, "pending");
    assert.equal(first.candidates[0]?.explicitness, "inferred");
    assert.equal(first.candidates[0]?.sensitivity, "sensitive");
    assert.equal(first.candidates[0]?.validFrom, "2026-10-01T07:00:00.000Z");
    assert.equal(first.candidates[0]?.reviewAfter, "2026-10-10T07:00:00.000Z");
    assert.equal(first.candidates[0]?.scopeId, setup.skylar.relationship.scopeId);
    assert.equal(setup.continuity.listForPersona(setup.skylar.persona.id).length, 0);
    assert.equal(setup.continuity.listForPersona(setup.advisor.persona.id).length, 0);

    const profile = setup.database
      .prepare(
        `SELECT
           persona_id, relationship_id, memory_class, extractor_version,
           sensitivity_assessment_status, assessed_sensitivity,
           sensitivity_confidence, sensitivity_classifier_id,
           sensitivity_reason_codes_json
         FROM ambient_candidate_profiles WHERE candidate_id = ?`,
      )
      .get(first.candidates[0]!.id) as {
      persona_id: string;
      relationship_id: string;
      memory_class: string;
      extractor_version: string;
      sensitivity_assessment_status: string;
      assessed_sensitivity: string;
      sensitivity_confidence: number;
      sensitivity_classifier_id: string;
      sensitivity_reason_codes_json: string;
    };
    assert.deepEqual(profile, {
      persona_id: setup.skylar.persona.id,
      relationship_id: setup.skylar.relationship.id,
      memory_class: "durable",
      extractor_version: "1",
      sensitivity_assessment_status: "unassessed",
      assessed_sensitivity: "sensitive",
      sensitivity_confidence: 0,
      sensitivity_classifier_id: "memtextual.unassessed",
      sensitivity_reason_codes_json: '["classifier_unavailable"]',
    });

    const repeated = await setup.ambient.captureInteraction(input);
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
    assert.equal(accepted.memory.sensitivity, "sensitive");
    assert.equal(accepted.memory.validFrom, "2026-10-01T07:00:00.000Z");
    assert.equal(accepted.memory.reviewAfter, "2026-10-10T07:00:00.000Z");
    assert.deepEqual(
      setup.continuity.retrieve({
        personaId: setup.skylar.persona.id,
        text: "Mr. Steve",
      }),
      [],
    );
    assert.equal(setup.continuity.listForPersona(setup.advisor.persona.id).length, 0);
  } finally {
    setup.database.close();
  }
});

test("ambient capture rejects evidence excerpts not found in the cited record", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.invalid-excerpt-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Steve prefers coffee.",
        type: "preference",
        memoryClass: "durable",
        evidence: [
          {
            sourceRecordId: records[0]!.id,
            excerpt: "I prefer coffee.",
          },
        ],
      },
    ],
  };
  const setup = fixture(extractor);
  try {
    await assert.rejects(
      setup.ambient.captureInteraction({
        personaId: setup.skylar.persona.id,
        source: {
          kind: "chat",
          title: "Conversation with Skylar",
          records: [
            {
              kind: "message",
              authorRole: "user",
              content: "I prefer tea.",
            },
          ],
        },
      }),
      /excerpts must occur verbatim/u,
    );
    const count = setup.database
      .prepare("SELECT COUNT(*) AS count FROM memory_candidates")
      .get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    setup.database.close();
  }
});

test("unassessed ambient candidates cannot be automatically accepted", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.unassessed-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Steve prefers short replies.",
        type: "preference",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
        explicitness: "explicit",
        confidence: 1,
      },
    ],
  };
  const setup = fixture(extractor, true);
  try {
    setup.automation.setPolicy(
      {
        name: "Trusted but unassessed extractor",
        mode: "risk_based",
        scopeId: setup.skylar.relationship.scopeId,
        conditions: {
          trustedProposerIds: [extractor.id],
          minimumConfidence: 1,
        },
      },
      { actor: "user", explicitUserAction: true },
    );
    const result = await setup.ambient.captureInteraction({
      personaId: setup.skylar.persona.id,
      source: {
        kind: "chat",
        title: "Unassessed policy capture",
        records: [
          { kind: "message", authorRole: "user", content: "Keep it short." },
        ],
      },
    });
    assert.equal(result.candidates[0]?.sensitivity, "sensitive");
    assert.equal(result.candidates[0]?.status, "pending");
    assert.ok(
      setup.automation
        .previewCandidate(result.candidates[0]!.id)
        .checks.some(
          ({ name, passed }) => name === "normal_sensitivity" && !passed,
        ),
    );
  } finally {
    setup.database.close();
  }
});

test("an explicit user policy may accept eligible ambient candidates only", async () => {
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
  const setup = fixture(extractor, true, normalClassifier);
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

    const result = await setup.ambient.captureInteraction({
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
    assert.deepEqual(
      result.candidates.map(({ sensitivity }) => sensitivity),
      ["normal", "sensitive"],
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

test("ambient capture rejects evidence outside the captured interaction", async () => {
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
    await assert.rejects(
      async () =>
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

test("sensitivity classification may raise but never lower a proposal", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.sensitivity-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Classifier raises this proposal.",
        type: "fact",
        memoryClass: "episodic",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
      {
        assertion: "Extractor already restricted this proposal.",
        type: "fact",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[1]!.id }],
        sensitivity: "restricted",
      },
    ],
  };
  const classifier: AmbientSensitivityClassifier = {
    id: "test.mixed-sensitivity",
    version: "3",
    classify: ({ proposal }) => ({
      sensitivity: proposal.assertion.startsWith("Classifier")
        ? "restricted"
        : "normal",
      confidence: 0.9,
      reasonCodes: ["test_signal"],
    }),
  };
  const setup = fixture(extractor, false, classifier);
  try {
    const result = await setup.ambient.captureInteraction({
      personaId: setup.skylar.persona.id,
      source: {
        kind: "chat",
        title: "Sensitivity assessment",
        records: [
          { kind: "message", content: "First evidence" },
          { kind: "message", content: "Second evidence" },
        ],
      },
    });
    assert.deepEqual(
      result.candidates.map(({ sensitivity }) => sensitivity),
      ["restricted", "restricted"],
    );
    const assessments = setup.database
      .prepare(
        `SELECT
           sensitivity_assessment_status AS status,
           assessed_sensitivity AS assessed,
           declared_sensitivity AS declared,
           sensitivity_classifier_id AS classifier
         FROM ambient_candidate_profiles
         ORDER BY candidate_id`,
      )
      .all() as Array<{
      status: string;
      assessed: string;
      declared: string | null;
      classifier: string;
    }>;
    assert.equal(assessments.length, 2);
    assert.ok(assessments.every(({ status }) => status === "assessed"));
    assert.ok(
      assessments.every(
        ({ classifier: classifierId }) => classifierId === classifier.id,
      ),
    );
    assert.ok(
      assessments.some(
        ({ assessed, declared }) =>
          assessed === "normal" && declared === "restricted",
      ),
    );
  } finally {
    setup.database.close();
  }
});

test("ambient capture uses one batch sensitivity assessment per interaction", async () => {
  let batchCalls = 0;
  const extractor: AmbientMemoryExtractor = {
    id: "test.batch-sensitivity-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "First proposal.",
        type: "fact",
        memoryClass: "episodic",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
      {
        assertion: "Second proposal.",
        type: "preference",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
    ],
  };
  const classifier: AmbientSensitivityClassifier = {
    id: "test.batch-sensitivity",
    version: "1",
    classify: () => {
      throw new Error("Individual classification should not run.");
    },
    classifyBatch: (inputs) => {
      batchCalls += 1;
      return inputs.map(() => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["normal_content"],
      }));
    },
  };
  const setup = fixture(extractor, false, classifier);
  try {
    const result = await setup.ambient.captureInteraction({
      personaId: setup.skylar.persona.id,
      source: {
        kind: "chat",
        title: "Batch sensitivity assessment",
        records: [{ kind: "message", content: "Evidence" }],
      },
    });
    assert.equal(batchCalls, 1);
    assert.equal(result.candidates.length, 2);
    assert.ok(
      result.candidates.every(({ sensitivity }) => sensitivity === "normal"),
    );
  } finally {
    setup.database.close();
  }
});

test("ambient capture rejects an incomplete batch sensitivity assessment", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.incomplete-batch-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Proposal without an assessment.",
        type: "fact",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
    ],
  };
  const classifier: AmbientSensitivityClassifier = {
    id: "test.incomplete-batch",
    version: "1",
    classify: () => ({
      sensitivity: "normal",
      confidence: 1,
      reasonCodes: ["normal_content"],
    }),
    classifyBatch: () => [],
  };
  const setup = fixture(extractor, false, classifier);
  try {
    await assert.rejects(
      setup.ambient.captureInteraction({
        personaId: setup.skylar.persona.id,
        source: {
          kind: "chat",
          title: "Incomplete batch",
          records: [{ kind: "message", content: "Evidence" }],
        },
      }),
      /one assessment per proposal/u,
    );
    assert.deepEqual(setup.ingestion.listCandidates(), []);
  } finally {
    setup.database.close();
  }
});

test("invalid sensitivity assessments fail before candidate creation", async () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.invalid-assessment-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: "Invalid sensitivity result",
        type: "fact",
        memoryClass: "episodic",
        evidence: [{ sourceRecordId: records[0]!.id }],
      },
    ],
  };
  const classifier: AmbientSensitivityClassifier = {
    id: "test.invalid-assessment",
    version: "1",
    classify: () => ({
      sensitivity: "normal",
      confidence: 1,
      reasonCodes: ["Raw sensitive detail: do not store"],
    }),
  };
  const setup = fixture(extractor, false, classifier);
  try {
    await assert.rejects(
      async () =>
        setup.ambient.captureInteraction({
          personaId: setup.skylar.persona.id,
          source: {
            kind: "chat",
            title: "Invalid assessment",
            records: [{ kind: "message", content: "Evidence" }],
          },
        }),
      /machine-readable identifiers/u,
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
            sensitivityAssessment: {
              status: "assessed",
              declaredSensitivity: null,
              assessedSensitivity: "normal",
              confidence: 1,
              classifierId: normalClassifier.id,
              classifierVersion: normalClassifier.version,
              reasonCodes: ["no_sensitive_signal"],
            },
          },
        }),
      /relationship scope/u,
    );
    assert.equal(setup.ingestion.listCandidates().length, 0);
  } finally {
    setup.database.close();
  }
});

test("database invariants reject understated ambient sensitivity", () => {
  const extractor: AmbientMemoryExtractor = {
    id: "test.sensitivity-invariant",
    version: "1",
    extract: () => [],
  };
  const setup = fixture(extractor);
  try {
    const imported = setup.ingestion.importSource({
      kind: "chat",
      title: "Sensitivity invariant source",
      records: [{ kind: "message", content: "Evidence" }],
    });
    assert.throws(
      () =>
        setup.ingestionRepository.proposeCandidate({
          assertion: "Understated sensitivity",
          type: "fact",
          scopeId: setup.skylar.relationship.scopeId,
          evidence: [{ sourceRecordId: imported.records[0]!.id }],
          sensitivity: "normal",
          proposedBy: "extractor",
          proposerId: extractor.id,
          ambientContext: {
            sourceId: imported.source.id,
            userId: setup.user.id,
            personaId: setup.skylar.persona.id,
            relationshipId: setup.skylar.relationship.id,
            memoryClass: "episodic",
            extractorId: extractor.id,
            extractorVersion: extractor.version,
            sensitivityAssessment: {
              status: "assessed",
              declaredSensitivity: null,
              assessedSensitivity: "sensitive",
              confidence: 1,
              classifierId: "test.sensitivity-classifier",
              classifierVersion: "1",
              reasonCodes: ["sensitive_signal"],
            },
          },
        }),
      /sensitivity assessment is invalid or understated/u,
    );
    assert.equal(setup.ingestion.listCandidates().length, 0);
  } finally {
    setup.database.close();
  }
});
