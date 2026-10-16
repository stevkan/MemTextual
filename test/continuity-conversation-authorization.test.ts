import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityConversationAuthorizationService,
  HostAuthorizationService,
  PersonaService,
  SqliteHostEventRepository,
  SqlitePersonaRepository,
  continuityConversationTurnEventKind,
  openMemTextualDatabase,
  type ConversationGrantBinding,
  type ConversationGrantStore,
  type ConversationGrantStoreReceipt,
  type StoreConversationGrantInput,
} from "../src/index.js";

class RecordingGrantStore implements ConversationGrantStore {
  readonly values = new Map<string, StoreConversationGrantInput>();
  failStore = false;
  failDelete = false;

  async store(
    input: StoreConversationGrantInput,
  ): Promise<ConversationGrantStoreReceipt> {
    if (this.failStore) throw new Error("simulated protected-store failure");
    const existing = this.values.get(input.authorizationId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(input)) {
      throw new Error("different grant already stored");
    }
    this.values.set(input.authorizationId, { ...input });
    return { authorizationId: input.authorizationId, created: existing === undefined };
  }

  async load(binding: ConversationGrantBinding): Promise<string | null> {
    const stored = this.values.get(binding.authorizationId);
    if (stored === undefined) return null;
    const { grant, ...storedBinding } = stored;
    if (JSON.stringify(storedBinding) !== JSON.stringify(binding)) {
      throw new Error("binding mismatch");
    }
    return grant;
  }

  async delete(binding: ConversationGrantBinding): Promise<boolean> {
    if (this.failDelete) throw new Error("simulated protected-delete failure");
    await this.load(binding);
    return this.values.delete(binding.authorizationId);
  }
}

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const personaRepository = new SqlitePersonaRepository(database);
  const personas = new PersonaService(personaRepository);
  const user = personas.createUser({ displayName: "Steve" });
  const persona = personas.createPersona({ userId: user.id, name: "Skylar" });
  const hostAuthorizations = new HostAuthorizationService(
    new SqliteHostEventRepository(database),
    personaRepository,
  );
  const grants = new RecordingGrantStore();
  const service = new ContinuityConversationAuthorizationService(
    hostAuthorizations,
    grants,
  );
  return { database, grants, hostAuthorizations, persona, service, user };
}

const explicitUserAction = { actor: "user" as const, explicitUserAction: true };

function authorizationInput(setup: ReturnType<typeof fixture>) {
  return {
    userId: setup.user.id,
    personaId: setup.persona.persona.id,
    hostId: "codex.app-server",
    allowedEventKinds: [continuityConversationTurnEventKind],
  };
}

test("conversation authorization stores its bearer only in the protected store", async () => {
  const setup = fixture();
  try {
    const authorization = await setup.service.authorize(
      authorizationInput(setup),
      explicitUserAction,
    );
    assert.equal("grant" in authorization, false);
    const stored = setup.grants.values.get(authorization.id);
    assert.match(stored?.grant ?? "", /^mthg_[A-Za-z0-9_-]{43}$/u);
    assert.equal(
      await setup.service.resolveForAuthorization(authorization),
      stored?.grant,
    );
    assert.deepEqual(
      await setup.service.resolveForPersonaAuthorization(
        authorization.id,
        setup.persona,
      ),
      { authorization, grant: stored?.grant },
    );
    assert.deepEqual(setup.service.listForPersona(setup.persona), [authorization]);
    assert.equal(
      setup.hostAuthorizations.list(setup.user.id)[0]?.status,
      "active",
    );
  } finally {
    setup.database.close();
  }
});

test("persona authorization resolution denies another persona before loading the grant", async () => {
  const setup = fixture();
  try {
    const authorization = await setup.service.authorize(
      authorizationInput(setup),
      explicitUserAction,
    );
    const otherPersona = new PersonaService(
      new SqlitePersonaRepository(setup.database),
    ).createPersona({ userId: setup.user.id, name: "Advisor" });
    assert.deepEqual(setup.service.listForPersona(otherPersona), []);
    await assert.rejects(
      setup.service.resolveForPersonaAuthorization(
        authorization.id,
        otherPersona,
      ),
      /authorization not found/u,
    );
  } finally {
    setup.database.close();
  }
});

test("protected-store failure revokes the newly issued authorization", async () => {
  const setup = fixture();
  try {
    setup.grants.failStore = true;
    await assert.rejects(
      setup.service.authorize(authorizationInput(setup), explicitUserAction),
      /storage failed; the new host authorization was revoked/u,
    );
    const authorizations = setup.hostAuthorizations.list(setup.user.id, true);
    assert.equal(authorizations.length, 1);
    assert.equal(authorizations[0]?.status, "revoked");
    assert.equal(setup.grants.values.size, 0);
  } finally {
    setup.database.close();
  }
});

test("revocation validates the full binding before changing authorization state", async () => {
  const setup = fixture();
  try {
    const authorization = await setup.service.authorize(
      authorizationInput(setup),
      explicitUserAction,
    );
    const binding: ConversationGrantBinding = {
      authorizationId: authorization.id,
      userId: authorization.userId,
      personaId: authorization.personaId,
      relationshipId: authorization.relationshipId,
      hostId: authorization.hostId,
    };
    await assert.rejects(
      setup.service.revoke(
        { ...binding, personaId: "other-persona" },
        explicitUserAction,
      ),
      /binding does not match/u,
    );
    assert.equal(
      setup.hostAuthorizations.list(setup.user.id)[0]?.status,
      "active",
    );

    const result = await setup.service.revoke(binding, explicitUserAction);
    assert.equal(result.authorization.status, "revoked");
    assert.equal(result.protectedGrantDeleted, true);
    assert.equal(setup.grants.values.size, 0);
  } finally {
    setup.database.close();
  }
});

test("a protected-delete failure leaves the authorization revoked", async () => {
  const setup = fixture();
  try {
    const authorization = await setup.service.authorize(
      authorizationInput(setup),
      explicitUserAction,
    );
    setup.grants.failDelete = true;
    await assert.rejects(
      setup.service.revoke(
        {
          authorizationId: authorization.id,
          userId: authorization.userId,
          personaId: authorization.personaId,
          relationshipId: authorization.relationshipId,
          hostId: authorization.hostId,
        },
        explicitUserAction,
      ),
      /simulated protected-delete failure/u,
    );
    assert.equal(
      setup.hostAuthorizations.list(setup.user.id, true)[0]?.status,
      "revoked",
    );
    await assert.rejects(
      setup.service.resolveForAuthorization(authorization),
      /authorization is not active/u,
    );
  } finally {
    setup.database.close();
  }
});
