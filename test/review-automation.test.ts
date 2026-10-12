import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ExplicitPolicyConfigurationRequiredError,
  IngestionService,
  ReviewAutomationService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqliteReviewPolicyRepository,
  openMemTextualDatabase,
  type ProposeMemoryCandidateInput,
} from "../src/index.js";

function automationFixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const ingestionRepository = new SqliteIngestionRepository(
    database,
    memoryRepository,
  );
  const policyRepository = new SqliteReviewPolicyRepository(
    database,
    ingestionRepository,
  );
  const automation = new ReviewAutomationService(
    ingestionRepository,
    policyRepository,
  );
  const service = new IngestionService(ingestionRepository, automation);
  const project = memoryRepository.createScope({
    kind: "project",
    name: "Automation project",
  });
  const conversation = memoryRepository.createScope({
    kind: "conversation",
    name: "Automation conversation",
    parentScopeId: project.id,
  });
  const trustedImport = service.importSource({
    kind: "chat",
    title: "Trusted user conversation",
    externalId: "chat:trusted-user:1",
    records: [
      {
        kind: "message",
        authorRole: "user",
        content: "The user explicitly prefers concise answers.",
      },
      {
        kind: "message",
        authorRole: "user",
        content: "The user explicitly prefers TypeScript.",
      },
    ],
  });
  const untrustedImport = service.importSource({
    kind: "file",
    title: "Untrusted import",
    externalId: "file:untrusted:1",
    records: [
      {
        kind: "entry",
        authorRole: "user",
        content: "This author role alone is not trusted.",
      },
    ],
  });
  return {
    automation,
    conversation,
    database,
    ingestionRepository,
    memoryRepository,
    project,
    service,
    trustedImport,
    untrustedImport,
  };
}

const explicitPolicyContext = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("review policies require explicit user configuration and preserve versions", () => {
  const fixture = automationFixture();
  try {
    assert.throws(
      () =>
        fixture.automation.setPolicy({ name: "Manual", mode: "manual" }),
      ExplicitPolicyConfigurationRequiredError,
    );
    assert.throws(
      () =>
        fixture.automation.setPolicy(
          {
            name: "Invalid trust",
            mode: "automatic_explicit",
            conditions: {
              trustedSources: [
                { kind: "chat", externalId: "chat:does-not-exist" },
              ],
            },
          },
          explicitPolicyContext,
        ),
      /must already exist/u,
    );

    const first = fixture.automation.setPolicy(
      { name: "Manual default", mode: "manual" },
      explicitPolicyContext,
    );
    const second = fixture.automation.setPolicy(
      {
        name: "Trusted explicit statements",
        mode: "automatic_explicit",
        conditions: {
          trustedSources: [
            { kind: "chat", externalId: fixture.trustedImport.source.externalId! },
          ],
        },
      },
      explicitPolicyContext,
    );

    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    const history = fixture.automation.listPolicies(undefined, true);
    assert.equal(history.length, 2);
    assert.equal(history.find(({ id }) => id === first.id)?.isActive, false);
    assert.equal(history.find(({ id }) => id === second.id)?.isActive, true);
  } finally {
    fixture.database.close();
  }
});

test("scope-specific policy precedence uses the narrowest active policy", () => {
  const fixture = automationFixture();
  try {
    fixture.automation.setPolicy(
      { name: "Global manual", mode: "manual" },
      explicitPolicyContext,
    );
    const projectPolicy = fixture.automation.setPolicy(
      {
        name: "Project explicit",
        mode: "automatic_explicit",
        scopeId: fixture.project.id,
        conditions: {
          trustedSources: [
            { kind: "chat", externalId: fixture.trustedImport.source.externalId! },
          ],
        },
      },
      explicitPolicyContext,
    );
    fixture.automation.setPolicy(
      {
        name: "Conversation manual",
        mode: "manual",
        scopeId: fixture.conversation.id,
      },
      explicitPolicyContext,
    );

    const projectCandidate = fixture.ingestionRepository.proposeCandidate({
      assertion: "The user explicitly prefers concise answers.",
      type: "preference",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.trustedImport.records[0]!.id },
      ],
    });
    const conversationCandidate = fixture.ingestionRepository.proposeCandidate({
      assertion: "The user explicitly prefers TypeScript.",
      type: "preference",
      scopeId: fixture.conversation.id,
      evidence: [
        { sourceRecordId: fixture.trustedImport.records[1]!.id },
      ],
    });

    assert.equal(
      fixture.automation.previewCandidate(projectCandidate.id).policy?.id,
      projectPolicy.id,
    );
    assert.equal(
      fixture.automation.previewCandidate(projectCandidate.id).outcome,
      "automatic_accept",
    );
    assert.equal(
      fixture.automation.previewCandidate(conversationCandidate.id).outcome,
      "manual_review",
    );
  } finally {
    fixture.database.close();
  }
});

test("trusted explicit evidence is accepted automatically with an audited policy decision", () => {
  const fixture = automationFixture();
  try {
    const policy = fixture.automation.setPolicy(
      {
        name: "Project explicit",
        mode: "automatic_explicit",
        scopeId: fixture.project.id,
        conditions: {
          trustedSources: [
            { kind: "chat", externalId: fixture.trustedImport.source.externalId! },
          ],
        },
      },
      explicitPolicyContext,
    );

    const candidate = fixture.service.proposeCandidate({
      assertion: "The user explicitly prefers concise answers.",
      type: "preference",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.trustedImport.records[0]!.id },
      ],
      proposedBy: "system",
    });

    assert.equal(candidate.status, "accepted");
    assert.equal(candidate.reviewedBy, "system");
    assert.ok(candidate.acceptedMemoryId !== null);

    const paraphrase = fixture.ingestionRepository.proposeCandidate({
      assertion: "The user likes brief responses.",
      type: "preference",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.trustedImport.records[0]!.id },
      ],
    });
    const paraphraseDecision = fixture.automation.previewCandidate(paraphrase.id);
    assert.equal(paraphraseDecision.outcome, "manual_review");
    assert.ok(
      paraphraseDecision.reasons.some((reason) =>
        reason.includes("assertion_supported"),
      ),
    );
    const event = fixture.database
      .prepare(
        `SELECT detail_json FROM candidate_events
         WHERE candidate_id = ? AND event_type = 'accepted'`,
      )
      .get(candidate.id) as { detail_json: string };
    const detail = JSON.parse(event.detail_json) as {
      policyId: string;
      policyVersion: number;
      reviewMethod: string;
    };
    assert.equal(detail.policyId, policy.id);
    assert.equal(detail.policyVersion, policy.version);
    assert.equal(detail.reviewMethod, "automatic");
  } finally {
    fixture.database.close();
  }
});

test("manual-only guardrails and untrusted provenance prevent automatic acceptance", () => {
  const fixture = automationFixture();
  try {
    fixture.automation.setPolicy(
      {
        name: "Risk-based project policy",
        mode: "risk_based",
        scopeId: fixture.project.id,
        conditions: {
          minimumConfidence: 0.8,
          trustedSources: [
            { kind: "chat", externalId: fixture.trustedImport.source.externalId! },
          ],
        },
      },
      explicitPolicyContext,
    );

    const base: ProposeMemoryCandidateInput = {
      assertion: "The user explicitly prefers concise answers.",
      type: "fact",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.trustedImport.records[0]!.id },
      ],
      confidence: 0.9,
    };
    const cases: Array<[string, ProposeMemoryCandidateInput]> = [
      ["inferred", { ...base, assertion: "Inferred.", explicitness: "inferred" }],
      ["sensitive", { ...base, assertion: "Sensitive.", sensitivity: "sensitive" }],
      ["protected", { ...base, assertion: "Protected.", isProtected: true }],
      ["instruction", { ...base, assertion: "Instruction.", type: "instruction" }],
      [
        "contradicting",
        {
          ...base,
          assertion: "Contradicting.",
          evidence: [
            {
              sourceRecordId: fixture.trustedImport.records[0]!.id,
              role: "contradicts",
            },
          ],
        },
      ],
      [
        "trusted_provenance",
        {
          ...base,
          assertion: "Untrusted.",
          evidence: [
            { sourceRecordId: fixture.untrustedImport.records[0]!.id },
          ],
        },
      ],
    ];

    for (const [expectedCheck, input] of cases) {
      const candidate = fixture.ingestionRepository.proposeCandidate(input);
      const decision = fixture.automation.previewCandidate(candidate.id);
      assert.equal(decision.outcome, "manual_review");
      assert.ok(
        decision.reasons.some((reason) =>
          reason.toLowerCase().includes(expectedCheck),
        ),
        `${expectedCheck} guardrail should explain the manual decision`,
      );
    }

    fixture.memoryRepository.create({
      assertion: "Existing exact assertion.",
      type: "fact",
      scopeId: fixture.project.id,
      createdBy: "user",
    });
    const duplicate = fixture.ingestionRepository.proposeCandidate({
      ...base,
      assertion: "Existing exact assertion.",
    });
    assert.ok(
      fixture.automation
        .previewCandidate(duplicate.id)
        .reasons.some((reason) => reason.includes("exact active-memory match")),
    );
  } finally {
    fixture.database.close();
  }
});

test("threshold policies accept trusted proposers and bulk review is per-candidate", () => {
  const fixture = automationFixture();
  try {
    fixture.automation.setPolicy(
      {
        name: "Trusted extractor threshold",
        mode: "automatic_threshold",
        scopeId: fixture.project.id,
        conditions: {
          minimumConfidence: 0.8,
          trustedProposerIds: ["extractor:local:v1"],
        },
      },
      explicitPolicyContext,
    );
    const accepted = fixture.service.proposeCandidate({
      assertion: "Trusted extractor fact.",
      type: "fact",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.untrustedImport.records[0]!.id },
      ],
      confidence: 0.9,
      proposedBy: "extractor",
      proposerId: "extractor:local:v1",
    });
    assert.equal(accepted.status, "accepted");

    const pending = fixture.ingestionRepository.proposeCandidate({
      assertion: "Manual bulk candidate.",
      type: "fact",
      scopeId: fixture.project.id,
      evidence: [
        { sourceRecordId: fixture.untrustedImport.records[0]!.id },
      ],
    });
    const bulk = fixture.service.bulkReviewCandidates(
      [pending.id, "missing-candidate"],
      "accept",
      { actor: "user", explicitUserAction: true },
    );
    assert.deepEqual(
      bulk.results.map(({ outcome }) => outcome),
      ["accepted", "failed"],
    );
    assert.equal(
      fixture.service.getCandidate(pending.id)?.status,
      "accepted",
    );
  } finally {
    fixture.database.close();
  }
});

test("policy CLI sets and lists a trusted local policy", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-policy-"));
  const databasePath = join(temporaryDirectory, "policy.db");
  const policyPath = join(temporaryDirectory, "manual-policy.json");
  writeFileSync(
    policyPath,
    JSON.stringify({ name: "Manual default", mode: "manual" }),
    "utf8",
  );

  try {
    const setResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "policy.ts"),
        "set",
        "--file",
        policyPath,
        "--database",
        databasePath,
        "--migrations",
        resolve("migrations"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(setResult.status, 0, setResult.stderr);
    assert.match(setResult.stdout, /"mode": "manual"/u);

    const listResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "policy.ts"),
        "list",
        "--database",
        databasePath,
        "--migrations",
        resolve("migrations"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(listResult.status, 0, listResult.stderr);
    assert.match(listResult.stdout, /Manual default/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
