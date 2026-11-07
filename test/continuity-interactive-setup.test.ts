import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import test from "node:test";
import {
  collectContinuityInteractiveSetupInput,
  loadContinuityInstallationProfile,
} from "../src/index.js";

function answers(values: readonly string[]): (prompt: string) => Promise<string> {
  const pending = [...values];
  return async () => pending.shift() ?? "";
}

function runInteractiveSetup(
  arguments_: readonly string[],
  responses: readonly { answer: string; prompt: string }[],
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", resolve("src", "cli", "memtextual.ts"), ...arguments_],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let responseIndex = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const response = responses[responseIndex];
      if (response !== undefined && stdout.includes(response.prompt)) {
        child.stdin.write(`${response.answer}\n`);
        responseIndex += 1;
        if (responseIndex === responses.length) child.stdin.end();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectProcess);
    child.on("close", (code) => resolveProcess({ code, stderr, stdout }));
  });
}

test("interactive setup requires identity values and validates an absolute backup path", async () => {
  const result = await collectContinuityInteractiveSetupInput({
    ask: answers([
      "", " Test User ", "", " Test Persona ", "", "2",
      " Friendly companion ", " Trusted friend ", "relative", "D:\\Backups ",
    ]),
    dataRoot: "C:\\ProgramData\\MemTextual Continuity",
    extractionModels: [
      {
        description: "Balanced",
        displayName: "Sol",
        id: "catalog-sol",
        isDefault: true,
        model: "gpt-sol",
      },
      {
        description: "Efficient",
        displayName: "Luna",
        id: "catalog-luna",
        isDefault: false,
        model: "gpt-luna",
      },
    ],
  });

  assert.deepEqual(result, {
    backupDirectory: "D:\\Backups",
    extractionModel: "gpt-luna",
    personaDescription: "Friendly companion",
    personaName: "Test Persona",
    relationshipName: "Trusted friend",
    userDisplayName: "Test User",
  });
});

test("interactive setup uses the managed backup default and omits blank optional values", async () => {
  const result = await collectContinuityInteractiveSetupInput({
    ask: answers(["User", "Persona", "", "", ""]),
    dataRoot: "D:\\MemTextual",
    extractionModel: "gpt-example",
  });

  assert.deepEqual(result, {
    backupDirectory: "D:\\MemTextual\\backups",
    extractionModel: "gpt-example",
    personaName: "Persona",
    userDisplayName: "User",
  });
});

test(
  "interactive CLI creates one saved installation and will not reconfigure it",
  { skip: process.platform !== "win32" },
  async () => {
  const directory = mkdtempSync(join(tmpdir(), "memtextual-interactive-"));
  try {
    const first = await runInteractiveSetup([
      "setup", "--interactive",
      "--extraction-model", "gpt-example",
      "--data-root", directory,
      "--application-directory", resolve("."),
    ], [
      { answer: "Test User", prompt: "Your display name: " },
      { answer: "Test Persona", prompt: "Persona name: " },
      { answer: "Friendly companion", prompt: "Persona description (optional): " },
      { answer: "Trusted friend", prompt: "Relationship name (optional): " },
      { answer: "", prompt: "Backup directory [" },
      { answer: "", prompt: "Press Enter to close." },
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stderr, "");
    assert.match(first.stdout, /first-run setup/u);

    const profile = loadContinuityInstallationProfile(
      win32.join(directory, "installation.json"),
    );
    assert.ok(profile.userId.length > 0);
    assert.ok(profile.personaId.length > 0);

    const repeat = await runInteractiveSetup([
      "setup", "--interactive", "--data-root", directory,
    ], [
      { answer: "", prompt: "Press Enter to close." },
    ]);
    assert.equal(repeat.code, 0, repeat.stderr);
    assert.equal(repeat.stderr, "");
    assert.match(repeat.stdout, /No settings were changed/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  },
);
