import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  ContinuityBoundMcpPrincipalResolver,
  ContinuityIdentityBindingService,
  PersonaService,
  SqliteContinuityIdentityBindingRepository,
  SqlitePersonaRepository,
  continuityIdentityHash,
  openMemTextualDatabase,
  type ContinuityVerifiedIdentity,
} from "../src/index.js";

const verifiedIdentity: ContinuityVerifiedIdentity = {
  issuer: "https://identity.example.test",
  subject: "opaque-provider-subject",
};

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const personas = new PersonaService(new SqlitePersonaRepository(database));
  const bindings = new ContinuityIdentityBindingService(
    new SqliteContinuityIdentityBindingRepository(database),
    personas,
  );
  return { bindings, database, personas };
}

const explicitUserAction = {
  actor: "user" as const,
  explicitUserAction: true,
};

test("Continuity identity binding resolves an opaque verified identity without storing its subject", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const binding = setup.bindings.bind(
      verifiedIdentity,
      user.id,
      explicitUserAction,
    );
    const identityHash = continuityIdentityHash(verifiedIdentity);
    assert.equal(binding.identityHash, identityHash);
    assert.equal(binding.userId, user.id);
    assert.equal(binding.status, "active");
    assert.equal(binding.issuer, verifiedIdentity.issuer);

    assert.deepEqual(setup.bindings.resolve(verifiedIdentity), {
      authenticationSubject: identityHash,
      continuityUserId: user.id,
    });
    assert.equal(
      setup.bindings.bind(verifiedIdentity, user.id, explicitUserAction).id,
      binding.id,
      "repeating the exact binding should be idempotent",
    );

    const columns = setup.database
      .prepare("PRAGMA table_info(continuity_identity_bindings)")
      .all()
      .map((row) => (row as { name: string }).name);
    assert.equal(columns.includes("subject"), false);
    assert.equal(
      JSON.stringify(
        setup.database
          .prepare("SELECT * FROM continuity_identity_bindings")
          .all(),
      ).includes(verifiedIdentity.subject),
      false,
    );
  } finally {
    setup.database.close();
  }
});

test("Continuity identity binding requires explicit mutations and cannot be reassigned", () => {
  const setup = fixture();
  try {
    const firstUser = setup.personas.createUser({ displayName: "First user" });
    const secondUser = setup.personas.createUser({ displayName: "Second user" });
    assert.throws(
      () => setup.bindings.bind(verifiedIdentity, firstUser.id),
      /explicit user action/iu,
    );
    const binding = setup.bindings.bind(
      verifiedIdentity,
      firstUser.id,
      explicitUserAction,
    );
    assert.throws(
      () =>
        setup.bindings.bind(
          verifiedIdentity,
          secondUser.id,
          explicitUserAction,
        ),
      /cannot be reassigned/iu,
    );
    assert.throws(
      () =>
        setup.database
          .prepare(
            "UPDATE continuity_identity_bindings SET user_id = ? WHERE id = ?",
          )
          .run(secondUser.id, binding.id),
      /ownership cannot be changed/iu,
    );
    assert.throws(
      () =>
        setup.database
          .prepare("DELETE FROM continuity_identity_bindings WHERE id = ?")
          .run(binding.id),
      /cannot be deleted/iu,
    );
    assert.throws(
      () => setup.bindings.revoke(verifiedIdentity),
      /explicit user action/iu,
    );
    const revoked = setup.bindings.revoke(
      verifiedIdentity,
      explicitUserAction,
    );
    assert.equal(revoked.status, "revoked");
    assert.ok(revoked.revokedAt !== null);
    assert.throws(
      () =>
        setup.database
          .prepare(
            `UPDATE continuity_identity_bindings
             SET status = 'active', revoked_at = NULL
             WHERE id = ?`,
          )
          .run(binding.id),
      /revocation is one-way/iu,
    );
    assert.throws(
      () => setup.bindings.resolve(verifiedIdentity),
      /not bound to an active Continuity user/iu,
    );
    assert.throws(
      () =>
        setup.bindings.bind(
          verifiedIdentity,
          firstUser.id,
          explicitUserAction,
        ),
      /cannot be reassigned/iu,
    );
  } finally {
    setup.database.close();
  }
});

test("Continuity identity binding preview hides the subject and confirmation binds current state", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    const identity = {
      issuer: "https://identity.example.test/",
      subject: "auth0|private-user-subject",
    };
    const preview = setup.bindings.preview(identity, user.id);
    assert.equal(preview.alreadyBound, false);
    assert.equal(JSON.stringify(preview).includes(identity.subject), false);
    assert.match(preview.confirmation, /^BIND-CONTINUITY-IDENTITY-[A-F0-9]{20}$/u);
    assert.throws(
      () =>
        setup.bindings.bindConfirmed(identity, user.id, "wrong", {
          actor: "user",
          explicitUserAction: true,
        }),
      /current identity-binding preview/iu,
    );
    const binding = setup.bindings.bindConfirmed(
      identity,
      user.id,
      preview.confirmation,
      { actor: "user", explicitUserAction: true },
    );
    assert.equal(binding.userId, user.id);
    const current = setup.bindings.preview(identity, user.id);
    assert.equal(current.alreadyBound, true);
    assert.notEqual(current.confirmation, preview.confirmation);
  } finally {
    setup.database.close();
  }
});

test("Continuity bound MCP principal resolver accepts only extracted verified identity", () => {
  const setup = fixture();
  try {
    const user = setup.personas.createUser({ displayName: "Steve" });
    setup.bindings.bind(verifiedIdentity, user.id, explicitUserAction);
    const resolver = new ContinuityBoundMcpPrincipalResolver(setup.bindings, {
      extract(authInfo) {
        assert.equal(authInfo.clientId, "chatgpt-test");
        return verifiedIdentity;
      },
    });
    assert.deepEqual(
      resolver.resolve({
        token: "test-token",
        clientId: "chatgpt-test",
        scopes: ["continuity.read"],
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        resource: new URL("https://continuity.example.test/mcp"),
      }),
      {
        authenticationSubject: continuityIdentityHash(verifiedIdentity),
        continuityUserId: user.id,
      },
    );
  } finally {
    setup.database.close();
  }
});

test("identity binding migration upgrades schema 21 without changing existing persona data", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "memtextual-identity-binding-"),
  );
  const oldMigrations = join(temporaryDirectory, "old-migrations");
  const databasePath = join(temporaryDirectory, "schema-21.db");
  mkdirSync(oldMigrations);
  for (const filename of readdirSync(resolve("migrations")).filter(
    (name) => Number.parseInt(name.slice(0, 3), 10) <= 21,
  )) {
    copyFileSync(resolve("migrations", filename), join(oldMigrations, filename));
  }

  let userId = "";
  let personaId = "";
  try {
    const oldDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: oldMigrations,
    });
    try {
      const personas = new PersonaService(new SqlitePersonaRepository(oldDatabase));
      const user = personas.createUser({ displayName: "Existing user" });
      const persona = personas.createPersona({
        userId: user.id,
        name: "Existing persona",
      });
      userId = user.id;
      personaId = persona.persona.id;
    } finally {
      oldDatabase.close();
    }

    const upgraded = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const personas = new PersonaService(new SqlitePersonaRepository(upgraded));
      assert.equal(personas.getUser(userId)?.displayName, "Existing user");
      assert.equal(
        personas.getPersonaContext(personaId)?.persona.name,
        "Existing persona",
      );
      assert.deepEqual(
        upgraded
          .prepare("SELECT name FROM schema_migrations WHERE version = 22")
          .get(),
        { name: "continuity_identity_bindings_v0.9" },
      );
      assert.equal(
        (
          upgraded
            .prepare(
              "SELECT count(*) AS count FROM continuity_identity_bindings",
            )
            .get() as { count: number }
        ).count,
        0,
      );
      assert.deepEqual(upgraded.prepare("PRAGMA foreign_key_check").all(), []);
      assert.deepEqual(upgraded.prepare("PRAGMA integrity_check").pluck().get(), "ok");
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
