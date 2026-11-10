import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexAppServerExplicitSensitivityAssessor,
  type CodexAppServerStructuredTaskInput,
} from "../src/index.js";

function input(requestedSensitivity?: "normal" | "sensitive" | "restricted") {
  return {
    principal: {
      authenticationSubject: "identity-hash",
      continuityUserId: "user-id",
    },
    persona: {
      persona: {
        id: "persona-id",
        userId: "user-id",
        name: "Jeeves",
        externalId: null,
        description: null,
        scopeId: "persona-scope",
        metadata: {},
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
      relationship: {
        id: "relationship-id",
        userId: "user-id",
        personaId: "persona-id",
        name: "Advisor",
        scopeId: "relationship-scope",
        metadata: {},
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
    },
    assertion: "Please remember this ordinary preference.",
    memoryClass: "durable" as const,
    type: "preference" as const,
    ...(requestedSensitivity === undefined ? {} : { requestedSensitivity }),
  };
}

test("Codex explicit sensitivity assessor sends only bounded untrusted memory data", async () => {
  let observed: CodexAppServerStructuredTaskInput | undefined;
  const assessor = new CodexAppServerExplicitSensitivityAssessor(
    {
      runStructuredTask(task) {
        observed = task;
        return Promise.resolve(
          JSON.stringify({
            sensitivity: "normal",
            confidence: 0.98,
            reasonCodes: ["normal_content"],
          }),
        );
      },
    },
    { model: "gpt-test" },
  );
  assert.deepEqual(await assessor.assess(input()), {
    sensitivity: "normal",
    confidence: 0.98,
    reasonCodes: ["normal_content"],
  });
  assert.equal(observed?.model, "gpt-test");
  assert.match(observed?.developerInstructions ?? "", /untrusted memory data/iu);
  assert.deepEqual(JSON.parse(observed?.input ?? "{}"), {
    format: "memtextual.explicit_sensitivity_input",
    formatVersion: 1,
    contentRole: "untrusted_memory_data",
    assertion: "Please remember this ordinary preference.",
    memoryClass: "durable",
    type: "preference",
    declaredSensitivity: null,
  });
  assert.equal((observed?.input ?? "").includes("identity-hash"), false);
  assert.equal((observed?.input ?? "").includes("Jeeves"), false);
});

test("Codex explicit sensitivity assessor never lowers a declared sensitivity", async () => {
  const assessor = new CodexAppServerExplicitSensitivityAssessor(
    {
      runStructuredTask: () =>
        Promise.resolve(
          JSON.stringify({
            sensitivity: "normal",
            confidence: 0.75,
            reasonCodes: ["normal_content"],
          }),
        ),
    },
    { model: "gpt-test" },
  );
  assert.deepEqual(await assessor.assess(input("restricted")), {
    sensitivity: "restricted",
    confidence: 0.75,
    reasonCodes: ["declared_sensitivity_floor", "normal_content"],
  });
});

test("Codex explicit sensitivity assessor fails closed on malformed output", async () => {
  const assessor = new CodexAppServerExplicitSensitivityAssessor(
    { runStructuredTask: () => Promise.resolve("{}") },
    { model: "gpt-test" },
  );
  await assert.rejects(assessor.assess(input()), /failed validation/iu);
  assert.throws(
    () =>
      new CodexAppServerExplicitSensitivityAssessor(
        { runStructuredTask: () => Promise.resolve("{}") },
        { model: " " },
      ),
    /model/iu,
  );
});
