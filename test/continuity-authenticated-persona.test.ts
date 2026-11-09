import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityAuthenticatedPersonaService,
  PersonaService,
  SqlitePersonaRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const personas = new PersonaService(new SqlitePersonaRepository(database));
  const access = new ContinuityAuthenticatedPersonaService(personas);
  return { access, database, personas };
}

test("authenticated persona access derives ownership from the trusted principal", () => {
  const setup = fixture();
  try {
    const firstUser = setup.personas.createUser({ displayName: "First user" });
    const secondUser = setup.personas.createUser({ displayName: "Second user" });
    const firstPrincipal = {
      authenticationSubject: "oauth:first-user",
      continuityUserId: firstUser.id,
    };
    const secondPrincipal = {
      authenticationSubject: "oauth:second-user",
      continuityUserId: secondUser.id,
    };
    const firstPersona = setup.access.createPersona(firstPrincipal, {
      name: "Skylar",
      description: "Friendly companion",
    });
    const secondPersona = setup.access.createPersona(secondPrincipal, {
      name: "Advisor",
    });

    assert.equal(setup.access.getProfile(firstPrincipal).id, firstUser.id);
    assert.deepEqual(
      setup.access.listPersonas(firstPrincipal).map(({ persona }) => persona.id),
      [firstPersona.persona.id],
    );
    assert.equal(
      setup.access.getPersona(firstPrincipal, firstPersona.persona.id).persona.name,
      "Skylar",
    );
    assert.throws(
      () => setup.access.getPersona(firstPrincipal, secondPersona.persona.id),
      /Persona not found/u,
    );

    const updated = setup.access.updatePersona(firstPrincipal, {
      personaId: firstPersona.persona.id,
      expectedUpdatedAt: firstPersona.persona.updatedAt,
      relationshipName: "Long-term companion",
    });
    assert.equal(updated.relationship.name, "Long-term companion");
    assert.throws(
      () =>
        setup.access.updatePersona(firstPrincipal, {
          personaId: secondPersona.persona.id,
          expectedUpdatedAt: secondPersona.persona.updatedAt,
          name: "Cross-user change",
        }),
      /Persona not found/u,
    );
    assert.equal(
      setup.access.getPersona(secondPrincipal, secondPersona.persona.id).persona.name,
      "Advisor",
    );
  } finally {
    setup.database.close();
  }
});

test("authenticated persona access rejects missing or invalid principals", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    assert.throws(
      () =>
        setup.access.listPersonas({
          authenticationSubject: " ",
          continuityUserId: user.id,
        }),
      /authenticated Continuity subject/u,
    );
    assert.throws(
      () =>
        setup.access.listPersonas({
          authenticationSubject: "oauth:missing-user",
          continuityUserId: "00000000-0000-4000-8000-000000000000",
        }),
      /Authenticated Continuity user not found/u,
    );
  } finally {
    setup.database.close();
  }
});
