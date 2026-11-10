import assert from "node:assert/strict";
import test from "node:test";
import {
  continuityMcpReadScope,
  continuityMcpExcludedOperations,
  continuityMcpServerInstructions,
  continuityMcpToolCatalog,
  continuityMcpWriteScope,
} from "../src/index.js";

const forbiddenCallerFields = new Set([
  "actor",
  "explicitUserAction",
  "relationshipId",
  "scopeId",
  "userId",
]);

test("Continuity ChatGPT contract has stable unique tools and safety metadata", () => {
  assert.deepEqual(
    continuityMcpToolCatalog.map(({ name }) => name),
    [
      "continuity_profile",
      "persona_list",
      "persona_get",
      "persona_create",
      "persona_update",
      "persona_behavior_get",
      "persona_behavior_update",
      "persona_memory_remember",
      "persona_memory_search",
      "persona_memory_list",
      "persona_memory_get",
      "persona_memory_revise",
      "persona_memory_archive",
      "persona_memory_restore",
      "persona_candidate_list",
      "persona_candidate_get",
      "persona_candidate_accept",
      "persona_candidate_ignore",
    ],
  );
  assert.equal(
    new Set(continuityMcpToolCatalog.map(({ name }) => name)).size,
    continuityMcpToolCatalog.length,
  );

  for (const tool of continuityMcpToolCatalog) {
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(
      tool.annotations.readOnlyHint,
      tool.authorization === "authenticated_read",
    );
    assert.equal(
      tool.annotations.destructiveHint,
      tool.authorization === "explicit_user_destructive_write",
    );
    assert.deepEqual(
      tool.requiredScopes,
      tool.authorization === "authenticated_read"
        ? [continuityMcpReadScope]
        : [continuityMcpWriteScope],
    );
  }
});

test("Continuity ChatGPT contract rejects caller-selected ownership boundaries", () => {
  for (const tool of continuityMcpToolCatalog) {
    const shape = tool.inputSchema.toJSONSchema() as {
      properties?: Record<string, unknown>;
    };
    for (const field of Object.keys(shape.properties ?? {})) {
      assert.equal(
        forbiddenCallerFields.has(field),
        false,
        `${tool.name} must not accept ${field}`,
      );
    }
  }

  const createPersona = continuityMcpToolCatalog.find(
    ({ name }) => name === "persona_create",
  );
  assert.ok(createPersona !== undefined);
  assert.equal(
    createPersona.inputSchema.safeParse({ name: "Skylar", userId: "another-user" })
      .success,
    false,
  );

  const remember = continuityMcpToolCatalog.find(
    ({ name }) => name === "persona_memory_remember",
  );
  assert.ok(remember !== undefined);
  assert.equal(
    remember.inputSchema.safeParse({
      personaId: "5317a15f-a976-493b-9b02-0e991cfa16d3",
      assertion: "The user prefers morning appointments.",
      memoryClass: "durable",
      type: "preference",
      scopeId: "caller-selected-scope",
    }).success,
    false,
  );
});

test("Continuity ChatGPT contract states explicit-only capture and exclusions", () => {
  assert.match(continuityMcpServerInstructions, /explicit tool calls only/iu);
  assert.match(continuityMcpServerInstructions, /never claim passive capture/iu);
  assert.match(continuityMcpServerInstructions, /explicitly asks to remember/iu);
  assert.match(continuityMcpServerInstructions, /archive is reversible/iu);
  assert.match(continuityMcpServerInstructions, /local Continuity client/iu);
  assert.match(continuityMcpServerInstructions, /never imply data was erased/iu);
  assert.ok(continuityMcpServerInstructions.length <= 512);

  assert.deepEqual(continuityMcpExcludedOperations, [
    "passive_chatgpt_turn_capture",
    "caller_selected_user_relationship_or_scope",
    "persona_deletion",
    "memory_recoverable_deletion",
    "memory_permanent_purge",
    "conversation_journal_purge",
    "host_authorization_management",
  ]);
});
