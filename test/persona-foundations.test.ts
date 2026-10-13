import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  PersonaService,
  SqlitePersonaRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const service = new PersonaService(new SqlitePersonaRepository(database));
  return { database, service };
}

test("one user can create multiple isolated persona relationship scopes", () => {
  const setup = fixture();
  try {
    const user = setup.service.createUser({
      displayName: "Steve",
      externalId: "local-user",
      metadata: { locale: "en-US" },
    });
    const skylar = setup.service.createPersona({
      userId: user.id,
      name: "Skylar",
      description: "Friendly companion",
      relationshipMetadata: { tone: "warm" },
    });
    const advisor = setup.service.createPersona({
      userId: user.id,
      name: "Advisor",
      relationshipName: "Strategic advisory relationship",
    });

    assert.equal(setup.service.listUsers()[0]?.id, user.id);
    assert.deepEqual(
      setup.service.listPersonas(user.id).map(({ persona }) => persona.name),
      ["Advisor", "Skylar"],
    );
    assert.notEqual(skylar.persona.scopeId, advisor.persona.scopeId);
    assert.notEqual(skylar.relationship.scopeId, advisor.relationship.scopeId);
    assert.equal(skylar.relationship.userId, user.id);
    assert.equal(skylar.relationship.personaId, skylar.persona.id);
    assert.deepEqual(skylar.relationship.metadata, { tone: "warm" });

    const scopes = setup.database
      .prepare(
        `SELECT id, scope_kind, parent_scope_id
         FROM scopes
         WHERE id IN (?, ?, ?, ?, ?)`,
      )
      .all(
        user.scopeId,
        skylar.persona.scopeId,
        skylar.relationship.scopeId,
        advisor.persona.scopeId,
        advisor.relationship.scopeId,
      ) as Array<{
      id: string;
      scope_kind: string;
      parent_scope_id: string | null;
    }>;
    const byId = new Map(scopes.map((scope) => [scope.id, scope]));
    assert.equal(byId.get(user.scopeId)?.scope_kind, "namespace");
    assert.equal(byId.get(user.scopeId)?.parent_scope_id, null);
    assert.equal(byId.get(skylar.persona.scopeId)?.parent_scope_id, user.scopeId);
    assert.equal(
      byId.get(skylar.relationship.scopeId)?.parent_scope_id,
      skylar.persona.scopeId,
    );
    assert.equal(byId.get(advisor.persona.scopeId)?.parent_scope_id, user.scopeId);
    assert.equal(
      byId.get(advisor.relationship.scopeId)?.parent_scope_id,
      advisor.persona.scopeId,
    );
    assert.deepEqual(setup.database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    setup.database.close();
  }
});

test("duplicate persona creation rolls back its scopes", () => {
  const setup = fixture();
  try {
    const user = setup.service.createUser({ displayName: "Steve" });
    setup.service.createPersona({ userId: user.id, name: "Skylar" });
    const before = (
      setup.database.prepare("SELECT count(*) AS count FROM scopes").get() as {
        count: number;
      }
    ).count;

    assert.throws(
      () => setup.service.createPersona({ userId: user.id, name: "skylar" }),
      /UNIQUE constraint failed/u,
    );
    const after = (
      setup.database.prepare("SELECT count(*) AS count FROM scopes").get() as {
        count: number;
      }
    ).count;
    assert.equal(after, before);
  } finally {
    setup.database.close();
  }
});

test("database invariants reject malformed persona scope ownership", () => {
  const setup = fixture();
  try {
    const firstUser = setup.service.createUser({ displayName: "First user" });
    const secondUser = setup.service.createUser({ displayName: "Second user" });
    const wrongScopeId = "wrong-persona-scope";
    setup.database
      .prepare(
        `INSERT INTO scopes (
           id, scope_kind, name, external_key, parent_scope_id
         ) VALUES (?, 'namespace', ?, ?, ?)`,
      )
      .run(
        wrongScopeId,
        "Wrong owner",
        "continuity:test:wrong-owner",
        firstUser.scopeId,
      );

    assert.throws(
      () =>
        setup.database
          .prepare(
            `INSERT INTO continuity_personas (
               id, user_id, name, scope_id
             ) VALUES (?, ?, ?, ?)`,
          )
          .run("invalid-persona", secondUser.id, "Invalid", wrongScopeId),
      /Persona scope must be a namespace child of its user scope/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("UPDATE scopes SET parent_scope_id = ? WHERE id = ?")
          .run(secondUser.scopeId, firstUser.scopeId),
      /bound Continuity scope hierarchy/u,
    );
  } finally {
    setup.database.close();
  }
});
