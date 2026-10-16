import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContinuityPersonaBehaviorService,
  PersonaService,
  SqliteContinuityPersonaBehaviorRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const personas = new PersonaService(new SqlitePersonaRepository(database));
  const user = personas.createUser({ displayName: "Steve" });
  const skylar = personas.createPersona({ userId: user.id, name: "Skylar" });
  const advisor = personas.createPersona({ userId: user.id, name: "Advisor" });
  const behaviors = new ContinuityPersonaBehaviorService(
    new SqliteContinuityPersonaBehaviorRepository(database),
  );
  return { advisor, behaviors, database, skylar };
}

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("persona behavior is optional, explicit, and isolated by persona", () => {
  const setup = fixture();
  try {
    assert.equal(setup.behaviors.getProfile(setup.skylar.persona.id), null);
    assert.deepEqual(
      setup.behaviors.listProfileHistory(setup.skylar.persona.id),
      [],
    );

    const input = {
      personaId: setup.skylar.persona.id,
      expectedRevisionNumber: null,
      instructions: "  Be warm and candid.\nKeep answers concise.  ",
      enabled: true,
      note: " Initial Skylar behavior. ",
    };
    assert.throws(
      () => setup.behaviors.configureProfile(input),
      /explicit user action/u,
    );

    const profile = setup.behaviors.configureProfile(input, explicitUserAction);
    assert.equal(profile.revisionNumber, 1);
    assert.equal(profile.instructions, input.instructions);
    assert.equal(profile.enabled, true);
    assert.equal(profile.createdBy, "user");
    assert.equal(profile.note, "Initial Skylar behavior.");
    assert.equal(setup.behaviors.getProfile(setup.advisor.persona.id), null);
    assert.deepEqual(
      setup.behaviors.listProfileHistory(setup.advisor.persona.id),
      [],
    );
  } finally {
    setup.database.close();
  }
});

test("persona behavior revisions are optimistic, disableable, and immutable", () => {
  const setup = fixture();
  try {
    const first = setup.behaviors.configureProfile(
      {
        personaId: setup.skylar.persona.id,
        expectedRevisionNumber: null,
        instructions: "Be warm and concise.",
        enabled: true,
      },
      explicitUserAction,
    );
    const disabled = setup.behaviors.configureProfile(
      {
        personaId: setup.skylar.persona.id,
        expectedRevisionNumber: first.revisionNumber,
        instructions: first.instructions,
        enabled: false,
        note: "Disable this persona behavior without deleting history.",
      },
      explicitUserAction,
    );
    assert.equal(disabled.revisionNumber, 2);
    assert.equal(disabled.enabled, false);
    assert.deepEqual(
      setup.behaviors
        .listProfileHistory(setup.skylar.persona.id)
        .map(({ revisionNumber, enabled }) => ({ revisionNumber, enabled })),
      [
        { revisionNumber: 1, enabled: true },
        { revisionNumber: 2, enabled: false },
      ],
    );

    assert.throws(
      () =>
        setup.behaviors.configureProfile(
          {
            personaId: setup.skylar.persona.id,
            expectedRevisionNumber: 1,
            instructions: "Stale edit.",
            enabled: true,
          },
          explicitUserAction,
        ),
      /changed from revision 1 to 2/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            `UPDATE continuity_persona_behavior_profiles
             SET instructions = ? WHERE id = ?`,
          )
          .run("Changed in place.", first.id),
      /cannot be changed/u,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("DELETE FROM continuity_persona_behavior_profiles WHERE id = ?")
          .run(first.id),
      /cannot be deleted/u,
    );
  } finally {
    setup.database.close();
  }
});

test("invalid behavior fails without creating a revision", () => {
  const setup = fixture();
  try {
    assert.throws(
      () =>
        setup.behaviors.configureProfile(
          {
            personaId: setup.skylar.persona.id,
            expectedRevisionNumber: null,
            instructions: " \n ",
            enabled: true,
          },
          explicitUserAction,
        ),
      /instructions must not be empty/u,
    );
    assert.deepEqual(
      setup.behaviors.listProfileHistory(setup.skylar.persona.id),
      [],
    );
  } finally {
    setup.database.close();
  }
});

