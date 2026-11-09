import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
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
  continuityMcpReadScope,
  continuityMcpWriteScope,
  createContinuityMcpHttpApplication,
  openMemTextualDatabase,
} from "../src/index.js";

const resourceServerUrl = new URL("https://continuity.example.test/mcp");
const issuerUrl = "https://identity.example.test";

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
  const user = personaService.createUser({ displayName: "Steve" });
  const principal = {
    authenticationSubject: "oauth:steve",
    continuityUserId: user.id,
  };
  let explicitUserAction = false;
  const observedTokens: string[] = [];

  const application = createContinuityMcpHttpApplication({
    oauthMetadata: {
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/authorize`,
      token_endpoint: `${issuerUrl}/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
    resourceServerUrl,
    tokenVerifier: {
      async verifyAccessToken(token) {
        observedTokens.push(token);
        return {
          token,
          clientId: "chatgpt-test",
          scopes:
            token === "read-write-token"
              ? [continuityMcpReadScope, continuityMcpWriteScope]
              : [continuityMcpReadScope],
          expiresAt:
            token === "expired-token"
              ? Math.floor(Date.now() / 1000) - 60
              : Math.floor(Date.now() / 1000) + 600,
          resource:
            token === "wrong-audience-token"
              ? new URL("https://other.example.test/mcp")
              : resourceServerUrl,
          extra: { subject: "oauth:steve" },
        };
      },
    },
    principalResolver: {
      resolve(authInfo) {
        assert.equal(authInfo.extra?.["subject"], principal.authenticationSubject);
        return principal;
      },
    },
    explicitUserActionPolicy: {
      authorize: () => explicitUserAction,
    },
    services: {
      personas,
      behaviors: new ContinuityPersonaBehaviorService(
        new SqliteContinuityPersonaBehaviorRepository(database),
      ),
      control,
      memories: continuityMemories,
      sensitivity: {
        assess: () => ({
          sensitivity: "normal",
          confidence: 1,
          reasonCodes: ["test_assessment"],
        }),
      },
    },
  });

  async function connectClient(token: string) {
    const client = new Client({
      name: "continuity-http-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(resourceServerUrl, {
      authProvider: { token: async () => token },
      fetch: (input, init) => application.fetch(new Request(input, init)),
      onInsufficientScope: "throw",
    });
    await client.connect(transport);
    return client;
  }

  return {
    application,
    connectClient,
    database,
    observedTokens,
    personas,
    principal,
    setExplicitUserAction(value: boolean) {
      explicitUserAction = value;
    },
  };
}

async function closeFixture(setup: Awaited<ReturnType<typeof fixture>>) {
  await setup.application.close();
  setup.database.close();
}

test("Continuity HTTP serves OAuth resource discovery and rejects unauthenticated requests", async () => {
  const setup = await fixture();
  try {
    const metadataResponse = await setup.application.fetch(
      new Request(
        "https://continuity.example.test/.well-known/oauth-protected-resource/mcp",
      ),
    );
    assert.equal(metadataResponse.status, 200);
    assert.deepEqual(await metadataResponse.json(), {
      resource: resourceServerUrl.href,
      authorization_servers: [issuerUrl],
      scopes_supported: [continuityMcpReadScope, continuityMcpWriteScope],
      resource_name: "memtextual-continuity",
    });

    const unauthenticated = await setup.application.fetch(
      new Request(resourceServerUrl, { method: "POST", body: "{}" }),
    );
    assert.equal(unauthenticated.status, 401);
    assert.match(
      unauthenticated.headers.get("www-authenticate") ?? "",
      /resource_metadata=/u,
    );

    const notFound = await setup.application.fetch(
      new Request("https://continuity.example.test/other"),
    );
    assert.equal(notFound.status, 404);
  } finally {
    await closeFixture(setup);
  }
});

test("Continuity HTTP binds a verified principal and never returns bearer tokens", async () => {
  const setup = await fixture();
  const client = await setup.connectClient("read-token");
  try {
    const profile = await client.callTool({
      name: "continuity_profile",
      arguments: {},
    });
    assert.deepEqual(profile.structuredContent, {
      id: setup.principal.continuityUserId,
      name: "Steve",
    });
    assert.equal(JSON.stringify(profile).includes("read-token"), false);
    assert.ok(setup.observedTokens.length > 0);
  } finally {
    await client.close();
    await closeFixture(setup);
  }
});

test("Continuity HTTP rejects wrong-audience and insufficient-scope tokens", async () => {
  const setup = await fixture();
  try {
    await assert.rejects(
      setup.connectClient("wrong-audience-token"),
      /unauthorized|authentication|invalid_token/iu,
    );
    await assert.rejects(
      setup.connectClient("expired-token"),
      /unauthorized|authentication|invalid_token/iu,
    );

    const client = await setup.connectClient("read-token");
    try {
      await assert.rejects(
        client.callTool({
          name: "persona_create",
          arguments: { name: "Skylar" },
        }),
        (error) => error instanceof InsufficientScopeError,
      );
      assert.equal(setup.personas.listPersonas(setup.principal).length, 0);
    } finally {
      await client.close();
    }
  } finally {
    await closeFixture(setup);
  }
});

test("Continuity HTTP requires a separate trusted explicit-action decision for writes", async () => {
  const setup = await fixture();
  const client = await setup.connectClient("read-write-token");
  try {
    const blocked = await client.callTool({
      name: "persona_create",
      arguments: { name: "Skylar" },
    });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked.content), /explicit user action/iu);
    assert.equal(setup.personas.listPersonas(setup.principal).length, 0);

    setup.setExplicitUserAction(true);
    const created = await client.callTool({
      name: "persona_create",
      arguments: { name: "Skylar" },
    });
    assert.equal(created.isError, undefined);
    assert.equal(setup.personas.listPersonas(setup.principal).length, 1);
  } finally {
    await client.close();
    await closeFixture(setup);
  }
});
