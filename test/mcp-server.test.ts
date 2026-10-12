import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  MemoryService,
  IngestionService,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  createMemTextualMcpServer,
  mcpServerName,
  mcpServerVersion,
  openMemTextualDatabase,
  resolveMcpRuntimeConfig,
} from "../src/index.js";

async function mcpFixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const memoryRepository = new SqliteMemoryRepository(database);
  const service = new MemoryService(memoryRepository);
  const ingestionService = new IngestionService(
    new SqliteIngestionRepository(database, memoryRepository),
  );
  const server = createMemTextualMcpServer(service, ingestionService);
  const client = new Client({ name: "memtextual-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, database, server };
}

function structuredResult<T>(result: { structuredContent?: unknown }): T {
  const content = result.structuredContent as { result?: T } | undefined;
  assert.ok(content !== undefined && "result" in content);
  return content.result as T;
}

test("MCP server exposes the local memory tool surface", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name).sort(),
      [
        "candidate_get",
        "candidate_list",
        "candidate_propose",
        "memory_archive",
        "memory_contradict",
        "memory_create",
        "memory_get",
        "memory_history",
        "memory_restore",
        "memory_retrieve",
        "memory_revise",
        "memory_supersede",
        "scope_create",
        "scope_list",
        "server_info",
        "source_import",
        "source_list",
        "source_record_get",
        "source_records",
      ],
    );
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("server_info reports server identity, capabilities, and the discovered tool catalog", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const listed = await client.listTools();
    const infoCall = await client.callTool({
      name: "server_info",
      arguments: {},
    });
    const info = structuredResult<{
      name: string;
      version: string;
      capabilities: Array<{
        name: string;
        status: "implemented" | "planned";
        interface: "mcp" | "cli" | null;
      }>;
      tools: Array<{
        name: string;
        description: string;
        annotations: {
          readOnlyHint: boolean;
          idempotentHint: boolean;
          openWorldHint: boolean;
          destructiveHint?: boolean;
        };
      }>;
    }>(infoCall);

    assert.equal(info.name, mcpServerName);
    assert.equal(info.version, mcpServerVersion);
    assert.equal(info.tools.length, 19);
    assert.deepEqual(
      info.tools.map(({ name }) => name).sort(),
      listed.tools.map(({ name }) => name).sort(),
    );

    for (const tool of info.tools) {
      const discovered = listed.tools.find(({ name }) => name === tool.name);
      assert.ok(discovered !== undefined);
      assert.equal(tool.description, discovered.description);
      assert.deepEqual(tool.annotations, discovered.annotations);
    }

    assert.ok(
      info.capabilities.some(
        ({ name, status }) =>
          name === "configurable_review_automation" && status === "planned",
      ),
    );
    assert.ok(
      info.capabilities.some(
        ({ name, status, interface: capabilityInterface }) =>
          name === "candidate_review" &&
          status === "implemented" &&
          capabilityInterface === "cli",
      ),
    );
    assert.equal(JSON.stringify(info).includes("databasePath"), false);
    assert.equal(JSON.stringify(info).includes("migrationsDirectory"), false);
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("MCP tools import sources and propose reviewable candidates", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const scopeCall = await client.callTool({
      name: "scope_create",
      arguments: { kind: "project", name: "Candidate review" },
    });
    const scope = structuredResult<{ id: string }>(scopeCall);

    const importCall = await client.callTool({
      name: "source_import",
      arguments: {
        kind: "chat",
        title: "Review conversation",
        externalId: "chat:review:1",
        records: [
          {
            kind: "message",
            authorRole: "user",
            content: "Keep candidate approval under user control.",
          },
        ],
      },
    });
    const imported = structuredResult<{
      created: boolean;
      records: Array<{ id: string }>;
    }>(importCall);
    assert.equal(imported.created, true);

    const recordCall = await client.callTool({
      name: "source_record_get",
      arguments: { id: imported.records[0]!.id },
    });
    const record = structuredResult<{ content: string }>(recordCall);
    assert.equal(record.content, "Keep candidate approval under user control.");

    const candidateCall = await client.callTool({
      name: "candidate_propose",
      arguments: {
        assertion: "Candidate approval remains under user control.",
        type: "instruction",
        scopeId: scope.id,
        evidence: [{ sourceRecordId: imported.records[0]!.id }],
      },
    });
    const candidate = structuredResult<{ id: string; status: string }>(
      candidateCall,
    );
    assert.equal(candidate.status, "pending");

    const pendingCall = await client.callTool({
      name: "candidate_list",
      arguments: { status: "pending" },
    });
    const pending = structuredResult<Array<{ id: string }>>(pendingCall);
    assert.equal(pending[0]?.id, candidate.id);

    const tools = await client.listTools();
    assert.equal(tools.tools.some(({ name }) => name === "candidate_accept"), false);
    assert.equal(tools.tools.some(({ name }) => name === "candidate_reject"), false);
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("MCP tools create a scope, store a memory, and retrieve it", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const scopeCall = await client.callTool({
      name: "scope_create",
      arguments: {
        kind: "project",
        name: "MCP integration",
        externalKey: "project:mcp-integration",
      },
    });
    const scope = structuredResult<{ id: string; name: string }>(scopeCall);
    assert.equal(scope.name, "MCP integration");

    const memoryCall = await client.callTool({
      name: "memory_create",
      arguments: {
        assertion: "MemTextual exposes a local MCP server.",
        type: "decision",
        scopeId: scope.id,
        isPinned: true,
      },
    });
    const memory = structuredResult<{ id: string; revisionNumber: number }>(
      memoryCall,
    );
    assert.equal(memory.revisionNumber, 1);

    const retrievalCall = await client.callTool({
      name: "memory_retrieve",
      arguments: {
        text: "local MCP server",
        scopeIds: [scope.id],
      },
    });
    const results = structuredResult<Array<{ memory: { id: string } }>>(
      retrievalCall,
    );
    assert.equal(results[0]?.memory.id, memory.id);

    const scopesCall = await client.callTool({
      name: "scope_list",
      arguments: {},
    });
    const scopes = structuredResult<Array<{ id: string }>>(scopesCall);
    assert.ok(scopes.some(({ id }) => id === scope.id));
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("MCP schema validation rejects invalid retrieval input", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const result = await client.callTool({
      name: "memory_retrieve",
      arguments: { text: "anything", scopeIds: [] },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /validation|scopeIds/iu);
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("MCP mutation tools cannot override protected memories", async () => {
  const { client, database, server } = await mcpFixture();

  try {
    const scopeCall = await client.callTool({
      name: "scope_create",
      arguments: { kind: "global", name: "Global" },
    });
    const scope = structuredResult<{ id: string }>(scopeCall);

    const memoryCall = await client.callTool({
      name: "memory_create",
      arguments: {
        assertion: "This memory requires explicit user control.",
        type: "instruction",
        scopeId: scope.id,
        isProtected: true,
      },
    });
    const memory = structuredResult<{ id: string }>(memoryCall);

    const archiveCall = await client.callTool({
      name: "memory_archive",
      arguments: { id: memory.id },
    });
    assert.equal(archiveCall.isError, true);
    assert.match(JSON.stringify(archiveCall.content), /protected/u);
  } finally {
    await client.close();
    await server.close();
    database.close();
  }
});

test("MCP runtime configuration supports flags, environment, and defaults", () => {
  const fromFlags = resolveMcpRuntimeConfig({
    argv: ["--database", "data/custom.db", "--migrations", "sql"],
    environment: {},
    workingDirectory: "C:\\work",
  });
  assert.equal(fromFlags.databasePath, resolve("C:\\work", "data/custom.db"));
  assert.equal(fromFlags.migrationsDirectory, resolve("C:\\work", "sql"));

  const fromEnvironment = resolveMcpRuntimeConfig({
    argv: [],
    environment: {
      MEMTEXTUAL_DB_PATH: "configured.db",
      MEMTEXTUAL_MIGRATIONS_DIR: "schema",
    },
    workingDirectory: "C:\\work",
  });
  assert.equal(
    fromEnvironment.databasePath,
    resolve("C:\\work", "configured.db"),
  );

  assert.throws(
    () => resolveMcpRuntimeConfig({ argv: ["--unknown"] }),
    /Unknown argument/u,
  );
});

test("stdio entry point completes an MCP handshake", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "memtextual-mcp-"));
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      resolve("src", "mcp", "stdio.ts"),
      "--database",
      join(temporaryDirectory, "stdio.db"),
      "--migrations",
      resolve("migrations"),
    ],
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "memory_retrieve"));
    assert.ok(tools.tools.some(({ name }) => name === "source_import"));
    assert.ok(tools.tools.some(({ name }) => name === "server_info"));

    const infoCall = await client.callTool({
      name: "server_info",
      arguments: {},
    });
    const info = structuredResult<{ version: string; tools: unknown[] }>(infoCall);
    assert.equal(info.version, "0.6.0");
    assert.equal(info.tools.length, 19);
  } finally {
    await client.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
