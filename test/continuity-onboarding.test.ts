import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  ContinuityOnboardingService,
  SqliteMemoryRepository,
  SqlitePersonaRepository,
  openMemTextualDatabase,
} from "../src/index.js";

function fixture() {
  const database = openMemTextualDatabase({
    filename: ":memory:",
    migrationsDirectory: resolve("migrations"),
  });
  const onboarding = new ContinuityOnboardingService(
    new SqlitePersonaRepository(database),
  );
  return { database, onboarding };
}

function runCli(arguments_: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("src", "cli", "continuity-setup.ts"),
        ...arguments_,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectProcess);
    child.on("close", (code) => resolveProcess({ stdout, stderr, code }));
  });
}

test("onboarding creates one user and persona and is idempotent", () => {
  const setup = fixture();
  try {
    const first = setup.onboarding.setup({
      userDisplayName: "Steve",
      personaName: "Skylar",
      personaDescription: "Friendly companion",
    });
    assert.equal(first.createdUser, true);
    assert.equal(first.createdPersona, true);

    const second = setup.onboarding.setup({
      userDisplayName: "steve",
      personaName: "skylar",
      personaDescription: "Friendly companion",
    });
    assert.equal(second.createdUser, false);
    assert.equal(second.createdPersona, false);
    assert.equal(second.user.id, first.user.id);
    assert.equal(second.personaContext.persona.id, first.personaContext.persona.id);
    assert.equal(setup.onboarding.status().length, 1);
    assert.equal(setup.onboarding.status()[0]?.personas.length, 1);
  } finally {
    setup.database.close();
  }
});

test("onboarding fails closed for ambiguous users and conflicting persona details", () => {
  const setup = fixture();
  try {
    const first = setup.onboarding.setup({
      userDisplayName: "Steve",
      personaName: "Skylar",
      personaDescription: "Friendly companion",
    });
    const repository = new SqlitePersonaRepository(setup.database);
    repository.createUser({ displayName: "Second user" });

    assert.throws(
      () => setup.onboarding.setup({ personaName: "Advisor" }),
      /More than one Continuity user exists/u,
    );
    assert.throws(
      () =>
        setup.onboarding.setup({
          userId: first.user.id,
          personaName: "Skylar",
          personaDescription: "Different description",
        }),
      /will not overwrite/u,
    );
    assert.equal(repository.listPersonas(first.user.id).length, 1);
  } finally {
    setup.database.close();
  }
});

test("onboarding rolls back a provisional user when persona selection fails", () => {
  const setup = fixture();
  try {
    assert.throws(
      () => setup.onboarding.setup({ userDisplayName: "Steve" }),
      /--persona-name is required/u,
    );
    assert.deepEqual(setup.onboarding.status(), []);
  } finally {
    setup.database.close();
  }
});

test("Continuity setup CLI snapshots before creating an idempotent identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-onboarding-"));
  const databasePath = join(directory, "data", "memtextual.db");
  const backupDirectory = join(directory, "backups");
  const common = [
    "--database",
    databasePath,
    "--migrations",
    resolve("migrations"),
  ];
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
    const existingDatabase = openMemTextualDatabase({
      filename: databasePath,
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const memories = new SqliteMemoryRepository(existingDatabase);
      const scope = memories.createScope({
        kind: "project",
        name: "Existing Developer data",
      });
      memories.create({
        assertion: "This memory existed before Continuity onboarding.",
        type: "fact",
        scopeId: scope.id,
      });
    } finally {
      existingDatabase.close();
    }

    const first = await runCli([
      "setup",
      "--backup-directory",
      backupDirectory,
      "--user-name",
      "Steve",
      "--persona-name",
      "Skylar",
      ...common,
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stderr, "");
    assert.match(first.stdout, /"created": true/u);
    assert.match(first.stdout, /Start the persona-bound console with:/u);
    const firstSnapshotDirectory = readdirSync(backupDirectory)[0]!;
    const snapshotDatabase = openMemTextualDatabase({
      filename: join(backupDirectory, firstSnapshotDirectory, "memtextual.db"),
      readonly: true,
    });
    try {
      assert.equal(
        (
          snapshotDatabase
            .prepare("SELECT count(*) AS count FROM memory_items")
            .get() as { count: number }
        ).count,
        1,
      );
      assert.equal(
        (
          snapshotDatabase
            .prepare("SELECT count(*) AS count FROM continuity_users")
            .get() as { count: number }
        ).count,
        0,
      );
    } finally {
      snapshotDatabase.close();
    }

    const second = await runCli([
      "setup",
      "--backup-directory",
      backupDirectory,
      "--user-name",
      "Steve",
      "--persona-name",
      "Skylar",
      ...common,
    ]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stderr, "");
    assert.match(second.stdout, /"created": false/u);

    const status = await runCli(["status", ...common]);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(status.stderr, "");
    const parsed = JSON.parse(status.stdout) as Array<{
      personas: Array<{ persona: { name: string } }>;
    }>;
    assert.equal(parsed.length, 1);
    assert.deepEqual(
      parsed[0]?.personas.map(({ persona }) => persona.name),
      ["Skylar"],
    );

    const database = openMemTextualDatabase({
      filename: databasePath,
      readonly: true,
    });
    try {
      assert.equal(
        (
          database.prepare("SELECT count(*) AS count FROM continuity_users").get() as {
            count: number;
          }
        ).count,
        1,
      );
      assert.equal(
        (
          database
            .prepare("SELECT count(*) AS count FROM continuity_personas")
            .get() as { count: number }
        ).count,
        1,
      );
      assert.equal(
        (
          database.prepare("SELECT count(*) AS count FROM memory_items").get() as {
            count: number;
          }
        ).count,
        1,
      );
      assert.deepEqual(database.pragma("foreign_key_check"), []);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Continuity setup CLI rejects an active database inside its backup directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-onboarding-path-"));
  const databasePath = join(directory, "memtextual.db");
  try {
    const result = await runCli([
      "setup",
      "--backup-directory",
      directory,
      "--user-name",
      "Steve",
      "--persona-name",
      "Skylar",
      "--database",
      databasePath,
      "--migrations",
      resolve("migrations"),
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must differ from the active database directory/u);
  } finally {
    rmSync(dirname(databasePath), { recursive: true, force: true });
  }
});

test("Continuity setup CLI rejects a backup inside the active database directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-onboarding-child-"));
  const databasePath = join(directory, "data", "memtextual.db");
  try {
    const result = await runCli([
      "setup",
      "--backup-directory",
      join(dirname(databasePath), "backups"),
      "--user-name",
      "Steve",
      "--persona-name",
      "Skylar",
      "--database",
      databasePath,
      "--migrations",
      resolve("migrations"),
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /may not be stored inside/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
