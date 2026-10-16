import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parseContinuityAcceptanceCliArguments } from "../src/cli/continuity-acceptance.js";
import {
  ContinuityOnboardingService,
  SqlitePersonaRepository,
  openMemTextualDatabase,
  verifyContinuityDatabaseAcceptance,
  verifyContinuityHostAcceptance,
  type WindowsHostInstallationPreview,
} from "../src/index.js";

function hostPreview(
  overrides: Partial<WindowsHostInstallationPreview> = {},
): WindowsHostInstallationPreview {
  return {
    confirmation: "INSTALL-WINDOWS-HOST-fixture",
    currentIdentity: {
      available: true,
      identityName: "MemTextualSvc",
      managedByMemTextual: true,
    },
    currentSchedules: [
      {
        enabled: true,
        installed: true,
        managedByMemTextual: true,
        scheduleId: "MemTextual-Backup",
      },
    ],
    formatVersion: 1,
    identityWillBeProvisioned: false,
    operation: "install",
    pathsWillBeProtected: [],
    schedulesWillBeInstalled: [],
    ...overrides,
  };
}

describe("Continuity installation acceptance", () => {
  it("verifies current schema, integrity, persona, and installed host state", () => {
    const directory = mkdtempSync(join(tmpdir(), "memtextual-acceptance-"));
    const database = openMemTextualDatabase({
      filename: join(directory, "memtextual.db"),
      migrationsDirectory: resolve("migrations"),
    });
    try {
      const personas = new SqlitePersonaRepository(database);
      const setup = new ContinuityOnboardingService(personas).setup({
        personaName: "Skylar",
        userDisplayName: "Steve",
      });
      const data = verifyContinuityDatabaseAcceptance({
        database,
        migrationsDirectory: resolve("migrations"),
        personaId: setup.personaContext.persona.id,
        personas,
      });
      assert.equal(data.databaseIntegrity, "ok");
      assert.equal(data.foreignKeyViolations, 0);
      assert.equal(data.migrationCount, 21);
      assert.equal(data.persona.name, "Skylar");

      assert.deepEqual(verifyContinuityHostAcceptance(hostPreview()), {
        identityName: "MemTextualSvc",
        scheduleIds: ["MemTextual-Backup"],
      });
    } finally {
      database.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("fails closed for an incomplete host installation", () => {
    assert.throws(
      () =>
        verifyContinuityHostAcceptance(
          hostPreview({ schedulesWillBeInstalled: ["MemTextual-Backup"] }),
        ),
      /host installation is incomplete/u,
    );
  });

  it("requires an explicit persona, configuration, and publisher fingerprint", () => {
    assert.deepEqual(
      parseContinuityAcceptanceCliArguments([
        "--persona",
        "persona-1",
        "--conversation-config",
        "C:\\ProgramData\\MemTextual Continuity\\conversation.json",
        "--trusted-fingerprint",
        "a".repeat(64),
      ]),
      {
        conversationConfigurationPath:
          "C:\\ProgramData\\MemTextual Continuity\\conversation.json",
        personaId: "persona-1",
        trustedFingerprint: "a".repeat(64),
      },
    );
    assert.throws(
      () => parseContinuityAcceptanceCliArguments(["--persona", "persona-1"]),
      /All three options are required/u,
    );
  });
});
