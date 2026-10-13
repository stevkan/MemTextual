import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  AmbientMemoryService,
  ContinuityControlService,
  ContinuityMemoryService,
  createContinuityConsoleApplication,
  IngestionService,
  MemoryService,
  PersonaService,
  SqliteContinuityControlRepository,
  SqliteContinuityMemoryRepository,
  SqliteIngestionRepository,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  startContinuityConsole,
  type AmbientMemoryExtractor,
  type ContinuityConsoleApplication,
  type ContinuityConsoleRequest,
} from "../src/index.js";

const origin = "http://127.0.0.1:47321";
const host = "127.0.0.1:47321";

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
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const continuity = new ContinuityMemoryService(
    new SqliteContinuityMemoryRepository(database, memoryRepository),
  );
  const control = new ContinuityControlService(
    new SqliteContinuityControlRepository(database),
    personaRepository,
    continuity,
    new MemoryService(memoryRepository),
    ingestion,
  );
  const extractor: AmbientMemoryExtractor = {
    id: "test.console-extractor",
    version: "1",
    extract: ({ records }) => [
      {
        assertion: records[0]!.content,
        type: "preference",
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
      id: "test.console-classifier",
      version: "1",
      classify: () => ({
        sensitivity: "normal",
        confidence: 1,
        reasonCodes: ["normal_content"],
      }),
    },
  );
  return { advisor, ambient, control, database, skylar };
}

async function capture(
  setup: ReturnType<typeof fixture>,
  personaId: string,
  content: string,
) {
  return setup.ambient.captureInteraction({
    personaId,
    source: {
      kind: "chat",
      title: "Console test",
      records: [{ kind: "message", authorRole: "user", content }],
    },
  });
}

function request(
  application: ContinuityConsoleApplication,
  token: string,
  input: ContinuityConsoleRequest,
) {
  return application.handle(
    {
      ...input,
      headers: {
        host,
        authorization: `Bearer ${token}`,
        ...input.headers,
      },
    },
    origin,
  );
}

test("Continuity console requires its session token and persona boundary", async () => {
  const setup = fixture();
  const token = "t".repeat(32);
  try {
    const skylarCapture = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers concise answers.",
    );
    const advisorCapture = await capture(
      setup,
      setup.advisor.persona.id,
      "Advisor-only candidate.",
    );
    const application = createContinuityConsoleApplication(
      { control: setup.control, personaContext: setup.skylar },
      token,
    );

    const page = await application.handle(
      { method: "GET", url: "/", headers: { host } },
      origin,
    );
    assert.equal(page.status, 200);
    assert.match(page.body, /MemTextual Continuity/u);
    assert.match(page.headers["Content-Security-Policy"] ?? "", /default-src 'self'/u);
    assert.equal(page.headers["X-Frame-Options"], "DENY");
    assert.equal(page.body.includes(token), false);

    const script = await application.handle(
      { method: "GET", url: "/app.js", headers: { host } },
      origin,
    );
    assert.equal(script.status, 200);
    assert.equal(script.body.includes(token), false);

    const unauthorized = await application.handle(
      { method: "GET", url: "/api/dashboard", headers: { host } },
      origin,
    );
    assert.equal(unauthorized.status, 401);

    const dashboardResponse = await request(application, token, {
      method: "GET",
      url: "/api/dashboard",
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = JSON.parse(dashboardResponse.body) as {
      persona: { id: string; name: string };
      candidates: Array<{ candidate: { id: string } }>;
      memories: unknown[];
    };
    assert.deepEqual(dashboard.persona, {
      id: setup.skylar.persona.id,
      name: "Skylar",
    });
    assert.deepEqual(
      dashboard.candidates.map(({ candidate }) => candidate.id),
      [skylarCapture.candidates[0]!.id],
    );
    assert.equal(dashboard.memories.length, 0);

    const reviewResponse = await request(application, token, {
      method: "GET",
      url: `/api/candidates/${skylarCapture.candidates[0]!.id}`,
    });
    const review = JSON.parse(reviewResponse.body) as {
      evidence: Array<{ record: { content: string } | null }>;
    };
    assert.equal(review.evidence[0]?.record?.content, "Steve prefers concise answers.");

    const crossPersona = await request(application, token, {
      method: "GET",
      url: `/api/candidates/${advisorCapture.candidates[0]!.id}`,
    });
    assert.equal(crossPersona.status, 404);

    const wrongHost = await application.handle(
      {
        method: "GET",
        url: "/api/dashboard",
        headers: { host: "attacker.example", authorization: `Bearer ${token}` },
      },
      origin,
    );
    assert.equal(wrongHost.status, 421);

    const absoluteUrl = await request(application, token, {
      method: "GET",
      url: "http://attacker.example/api/dashboard",
    });
    assert.equal(absoluteUrl.status, 421);
  } finally {
    setup.database.close();
  }
});

test("Continuity console requires same-origin explicit mutations", async () => {
  const setup = fixture();
  const token = "u".repeat(32);
  try {
    const captured = await capture(
      setup,
      setup.skylar.persona.id,
      "Steve prefers direct answers.",
    );
    const candidateId = captured.candidates[0]!.id;
    const application = createContinuityConsoleApplication(
      { control: setup.control, personaContext: setup.skylar },
      token,
    );
    const mutation = {
      method: "POST",
      headers: { "content-type": "application/json" },
    };

    const missingOrigin = await request(application, token, {
      ...mutation,
      url: `/api/candidates/${candidateId}/resolve`,
      body: JSON.stringify({ outcome: "create" }),
    });
    assert.equal(missingOrigin.status, 403);

    const acceptedResponse = await request(application, token, {
      ...mutation,
      url: `/api/candidates/${candidateId}/resolve`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ outcome: "create", note: "Confirmed in UI." }),
    });
    assert.equal(acceptedResponse.status, 200);
    const accepted = JSON.parse(acceptedResponse.body) as {
      memory: { id: string } | null;
    };
    const memoryId = accepted.memory!.id;

    const pinResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/pin`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ value: true }),
    });
    assert.equal(pinResponse.status, 200);
    assert.equal((JSON.parse(pinResponse.body) as { isPinned: boolean }).isPinned, true);

    const protectResponse = await request(application, token, {
      ...mutation,
      url: `/api/memories/${memoryId}/protect`,
      headers: { ...mutation.headers, origin },
      body: JSON.stringify({ value: true }),
    });
    assert.equal(protectResponse.status, 200);
    assert.equal(
      (JSON.parse(protectResponse.body) as { isProtected: boolean }).isProtected,
      true,
    );

    const memoryResponse = await request(application, token, {
      method: "GET",
      url: `/api/memories/${memoryId}`,
    });
    const detail = JSON.parse(memoryResponse.body) as {
      personaMemory: { memory: { isPinned: boolean; isProtected: boolean } };
      history: unknown[];
    };
    assert.equal(detail.personaMemory.memory.isPinned, true);
    assert.equal(detail.personaMemory.memory.isProtected, true);
    assert.equal(detail.history.length, 1);
  } finally {
    setup.database.close();
  }
});

test("Continuity console socket listener binds only to IPv4 loopback", async () => {
  const setup = fixture();
  try {
    const handle = await startContinuityConsole({
      control: setup.control,
      personaContext: setup.skylar,
      port: 0,
      token: "v".repeat(32),
    });
    try {
      assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
      assert.equal(handle.launchUrl, `${handle.origin}/#token=${"v".repeat(32)}`);
    } finally {
      await handle.close();
    }
  } finally {
    setup.database.close();
  }
});
