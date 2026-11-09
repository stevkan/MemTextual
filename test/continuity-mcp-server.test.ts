import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  ContinuityAuthenticatedPersonaService,
  ContinuityControlService,
  ContinuityMemoryService,
  ContinuityPersonaBehaviorService,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityMemoryRepository,
  SqliteContinuityPersonaBehaviorRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  continuityMcpToolCatalog,
  createContinuityMcpServer,
  openMemTextualDatabase,
  type AmbientMemoryExtractor,
  type ContinuityMcpInvocationAuthorization,
} from "../src/index.js";

async function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const memories = new MemoryService(memoryRepository);
  const ingestion = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const personaRepository = new SqlitePersonaRepository(database);
  const personaService = new PersonaService(personaRepository);
  const continuityMemories = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memoryRepository),
  );
  const control = new ContinuityControlService(
    new SqliteContinuityControlRepository(database),
    personaRepository,
    continuityMemories,
    memories,
    ingestion,
  );
  const personas = new ContinuityAuthenticatedPersonaService(personaService);
  const behaviors = new ContinuityPersonaBehaviorService(
    new SqliteContinuityPersonaBehaviorRepository(database),
  );
  const user = personaService.createUser({ displayName: "Steve" });
  const otherUser = personaService.createUser({ displayName: "Other user" });
  const principal = {
    authenticationSubject: "oauth:steve",
    continuityUserId: user.id,
  };
  const otherPrincipal = {
    authenticationSubject: "oauth:other",
    continuityUserId: otherUser.id,
  };
  let authorization: ContinuityMcpInvocationAuthorization = {
    principal,
    explicitUserAction: false,
  };
  const server = createContinuityMcpServer({
    authorization: {
      resolve: () => authorization,
    },
    personas,
    behaviors,
    control,
    memories: continuityMemories,
    sensitivity: {
      assess: ({ assertion }) => ({
        sensitivity: assertion.includes("private") ? "restricted" : "normal",
        confidence: 1,
        reasonCodes: ["test_assessment"],
      }),
    },
  });
  const client = new Client({ name: "continuity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const extractor: AmbientMemoryExtractor = {
    id: "test.continuity-mcp",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: records[0]!.content,
        type: "fact",
        memoryClass: "durable",
        evidence: [{ sourceRecordId: records[0]!.id }],
        explicitness: "explicit",
        confidence: 1,
      },
    ],
  };
  const ambient = new AmbientMemoryService(
    ingestion,
    personaRepository,
    extractor,
    {
      id: "test.continuity-mcp-classifier",
      version: "1",
      classify: () => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["test_normal"],
      }),
    },
  );

  return {
    ambient,
    client,
    control,
    database,
    otherPrincipal,
    personas,
    principal,
    server,
    setAuthorization(next: ContinuityMcpInvocationAuthorization) {
      authorization = next;
    },
  };
}

function structuredResult<T>(result: { structuredContent?: unknown }): T {
  assert.ok(result.structuredContent !== undefined);
  return result.structuredContent as T;
}

async function closeFixture(setup: Awaited<ReturnType<typeof fixture>>) {
  await setup.client.close();
  await setup.server.close();
  setup.database.close();
}

test("Continuity MCP server exposes only the contracted persona surface", async () => {
  const setup = await fixture();
  try {
    setup.personas.createPersona(setup.principal, { name: "Skylar" });
    const tools = await setup.client.listTools();
    assert.deepEqual(
      tools.tools.map(({ name }) => name),
      continuityMcpToolCatalog.map(({ name }) => name),
    );
    assert.equal(tools.tools.some(({ name }) => name === "scope_create"), false);
    assert.equal(tools.tools.some(({ name }) => name === "memory_create"), false);

    const profileCall = await setup.client.callTool({
      name: "continuity_profile",
      arguments: {},
    });
    assert.deepEqual(structuredResult(profileCall), {
      user: { id: setup.principal.continuityUserId, displayName: "Steve" },
      personaCount: 1,
      passiveCaptureAvailable: false,
      captureMode: "explicit_tool_calls_only",
    });
  } finally {
    await closeFixture(setup);
  }
});

test("Continuity MCP writes require trusted explicit-user authorization", async () => {
  const setup = await fixture();
  try {
    const blocked = await setup.client.callTool({
      name: "persona_create",
      arguments: { name: "Skylar" },
    });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked.content), /explicit user action/u);
    assert.equal(setup.personas.listPersonas(setup.principal).length, 0);

    setup.setAuthorization({
      principal: setup.principal,
      explicitUserAction: true,
    });
    const createdCall = await setup.client.callTool({
      name: "persona_create",
      arguments: {
        name: "Skylar",
        description: "Friendly companion",
        relationshipName: "Friend",
      },
    });
    const created = structuredResult<{
      persona: { id: string; updatedAt: string; relationshipName: string };
    }>(createdCall).persona;
    assert.equal(created.relationshipName, "Friend");

    const updatedCall = await setup.client.callTool({
      name: "persona_update",
      arguments: {
        personaId: created.id,
        expectedUpdatedAt: created.updatedAt,
        relationshipName: "Long-term friend",
      },
    });
    assert.equal(
      structuredResult<{ persona: { relationshipName: string } }>(updatedCall)
        .persona.relationshipName,
      "Long-term friend",
    );
    const listedCall = await setup.client.callTool({
      name: "persona_list",
      arguments: {},
    });
    assert.equal(
      structuredResult<{ personas: Array<{ id: string }> }>(listedCall).personas[0]
        ?.id,
      created.id,
    );
    const personaCall = await setup.client.callTool({
      name: "persona_get",
      arguments: { personaId: created.id },
    });
    assert.equal(
      structuredResult<{ persona: { name: string } }>(personaCall).persona.name,
      "Skylar",
    );
    const emptyBehaviorCall = await setup.client.callTool({
      name: "persona_behavior_get",
      arguments: { personaId: created.id },
    });
    assert.equal(
      structuredResult<{ behavior: null }>(emptyBehaviorCall).behavior,
      null,
    );
    const behaviorCall = await setup.client.callTool({
      name: "persona_behavior_update",
      arguments: {
        personaId: created.id,
        expectedRevisionNumber: null,
        instructions: "Be warm and concise.",
        enabled: true,
      },
    });
    assert.equal(
      structuredResult<{ behavior: { revisionNumber: number } }>(behaviorCall)
        .behavior.revisionNumber,
      1,
    );

    const otherPersona = setup.personas.createPersona(setup.otherPrincipal, {
      name: "Advisor",
    });
    const crossUser = await setup.client.callTool({
      name: "persona_get",
      arguments: { personaId: otherPersona.persona.id },
    });
    assert.equal(crossUser.isError, true);
    assert.match(JSON.stringify(crossUser.content), /Persona not found/u);
  } finally {
    await closeFixture(setup);
  }
});

test("Continuity MCP memory tools preserve persona boundaries and lifecycle", async () => {
  const setup = await fixture();
  try {
    const skylar = setup.personas.createPersona(setup.principal, { name: "Skylar" });
    setup.setAuthorization({
      principal: setup.principal,
      explicitUserAction: true,
    });
    const rememberedCall = await setup.client.callTool({
      name: "persona_memory_remember",
      arguments: {
        personaId: skylar.persona.id,
        assertion: "My private UAT marker is cobalt.",
        memoryClass: "durable",
        type: "fact",
        requestedSensitivity: "normal",
      },
    });
    const remembered = structuredResult<{
      memory: { id: string; sensitivity: string; revisionNumber: number };
    }>(rememberedCall).memory;
    assert.equal(remembered.sensitivity, "restricted");
    assert.equal(remembered.revisionNumber, 1);

    const searchCall = await setup.client.callTool({
      name: "persona_memory_search",
      arguments: { personaId: skylar.persona.id, text: "cobalt" },
    });
    assert.deepEqual(
      structuredResult<{ memories: unknown[] }>(searchCall).memories,
      [],
      "default retrieval must not expand into restricted memories",
    );
    const listCall = await setup.client.callTool({
      name: "persona_memory_list",
      arguments: { personaId: skylar.persona.id },
    });
    assert.equal(structuredResult<{ memories: unknown[] }>(listCall).memories.length, 1);
    const getCall = await setup.client.callTool({
      name: "persona_memory_get",
      arguments: { personaId: skylar.persona.id, memoryId: remembered.id },
    });
    assert.equal(
      structuredResult<{ memory: { id: string } }>(getCall).memory.id,
      remembered.id,
    );

    const revisedCall = await setup.client.callTool({
      name: "persona_memory_revise",
      arguments: {
        personaId: skylar.persona.id,
        memoryId: remembered.id,
        assertion: "My private UAT marker is cobalt-2.",
        changeKind: "corrected",
      },
    });
    assert.equal(
      structuredResult<{ memory: { revisionNumber: number } }>(revisedCall).memory
        .revisionNumber,
      2,
    );
    const archivedCall = await setup.client.callTool({
      name: "persona_memory_archive",
      arguments: { personaId: skylar.persona.id, memoryId: remembered.id },
    });
    assert.equal(
      structuredResult<{ memory: { status: string } }>(archivedCall).memory.status,
      "archived",
    );
    const restoredCall = await setup.client.callTool({
      name: "persona_memory_restore",
      arguments: { personaId: skylar.persona.id, memoryId: remembered.id },
    });
    assert.equal(
      structuredResult<{ memory: { status: string } }>(restoredCall).memory.status,
      "active",
    );
  } finally {
    await closeFixture(setup);
  }
});

test("Continuity MCP candidate review is persona-bound and explicit", async () => {
  const setup = await fixture();
  try {
    const skylar = setup.personas.createPersona(setup.principal, { name: "Skylar" });
    const first = await setup.ambient.captureInteraction({
      personaId: skylar.persona.id,
      source: {
        kind: "chat",
        title: "First candidate",
        records: [{ kind: "message", content: "Steve prefers concise replies." }],
      },
    });
    const second = await setup.ambient.captureInteraction({
      personaId: skylar.persona.id,
      source: {
        kind: "chat",
        title: "Second candidate",
        records: [{ kind: "message", content: "Temporary test detail." }],
      },
    });

    const listedCall = await setup.client.callTool({
      name: "persona_candidate_list",
      arguments: { personaId: skylar.persona.id, status: "pending" },
    });
    assert.equal(
      structuredResult<{ candidates: unknown[] }>(listedCall).candidates.length,
      2,
    );
    const candidateCall = await setup.client.callTool({
      name: "persona_candidate_get",
      arguments: {
        personaId: skylar.persona.id,
        candidateId: first.candidates[0]!.id,
      },
    });
    assert.equal(
      structuredResult<{ candidate: { id: string } }>(candidateCall).candidate.id,
      first.candidates[0]!.id,
    );

    const blockedAccept = await setup.client.callTool({
      name: "persona_candidate_accept",
      arguments: {
        personaId: skylar.persona.id,
        candidateId: first.candidates[0]!.id,
      },
    });
    assert.equal(blockedAccept.isError, true);

    setup.setAuthorization({
      principal: setup.principal,
      explicitUserAction: true,
    });
    const acceptedCall = await setup.client.callTool({
      name: "persona_candidate_accept",
      arguments: {
        personaId: skylar.persona.id,
        candidateId: first.candidates[0]!.id,
        note: "Confirmed by user",
      },
    });
    assert.equal(
      structuredResult<{ memory: { assertion: string } }>(acceptedCall).memory
        .assertion,
      "Steve prefers concise replies.",
    );

    const ignoredCall = await setup.client.callTool({
      name: "persona_candidate_ignore",
      arguments: {
        personaId: skylar.persona.id,
        candidateId: second.candidates[0]!.id,
      },
    });
    assert.equal(
      structuredResult<{ candidate: { status: string } }>(ignoredCall).candidate
        .status,
      "rejected",
    );
  } finally {
    await closeFixture(setup);
  }
});
