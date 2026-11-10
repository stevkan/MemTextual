#!/usr/bin/env node

import { loadContinuityInstallationProfile } from "../configuration/continuity-installation-profile.js";
import { openMemTextualDatabase } from "../database/sqlite-database.js";
import type { ContinuityVerifiedIdentity } from "../domain/continuity-identity.js";
import { SqliteContinuityIdentityBindingRepository } from "../repositories/sqlite-continuity-identity-binding-repository.js";
import { SqlitePersonaRepository } from "../repositories/sqlite-persona-repository.js";
import { ContinuityIdentityBindingService } from "../services/continuity-identity-binding-service.js";
import { PersonaService } from "../services/persona-service.js";

type Command = "bind-preview" | "bind-apply";

interface ParsedArguments {
  command: Command;
  confirmation?: string;
  identity: ContinuityVerifiedIdentity;
  profilePath?: string;
}

function usage(): string {
  return [
    "Usage:",
    "  memtextual-continuity-identity bind-preview --issuer URL --subject SUBJECT [--profile PATH]",
    "  memtextual-continuity-identity bind-apply --issuer URL --subject SUBJECT --confirm TOKEN [--profile PATH]",
    "",
    "The Auth0 subject is used locally to derive the binding hash and is not stored or echoed.",
  ].join("\n");
}

function parseArguments(argv: string[]): ParsedArguments {
  const [commandValue, ...rest] = argv;
  if (commandValue !== "bind-preview" && commandValue !== "bind-apply") {
    throw new Error(usage());
  }
  const command: Command = commandValue;
  const allowed = new Set(["--confirm", "--issuer", "--profile", "--subject"]);
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index]!;
    if (!allowed.has(option)) {
      throw new Error(`Unknown argument: ${option}\n\n${usage()}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}.`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate argument: ${option}.`);
    }
    values.set(option, value);
    index += 1;
  }
  const required = (option: string): string => {
    const value = values.get(option)?.trim();
    if (value === undefined || value === "") {
      throw new Error(`${command} requires ${option}.`);
    }
    return value;
  };
  const confirmation = values.get("--confirm")?.trim();
  if (command === "bind-preview" && confirmation !== undefined) {
    throw new Error("bind-preview does not accept --confirm.");
  }
  if (command === "bind-apply" && !confirmation) {
    throw new Error("bind-apply requires --confirm.");
  }
  const profilePath = values.get("--profile");
  return {
    command,
    identity: {
      issuer: required("--issuer"),
      subject: required("--subject"),
    },
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(profilePath === undefined ? {} : { profilePath }),
  };
}

function main(): void {
  const arguments_ = parseArguments(process.argv.slice(2));
  const profile = loadContinuityInstallationProfile(arguments_.profilePath);
  const database = openMemTextualDatabase({
    filename: profile.databasePath,
    migrationsDirectory: profile.migrationsDirectory,
  });
  try {
    const personas = new PersonaService(new SqlitePersonaRepository(database));
    const bindings = new ContinuityIdentityBindingService(
      new SqliteContinuityIdentityBindingRepository(database),
      personas,
    );
    const result =
      arguments_.command === "bind-preview"
        ? bindings.preview(arguments_.identity, profile.userId)
        : bindings.bindConfirmed(
            arguments_.identity,
            profile.userId,
            arguments_.confirmation!,
            { actor: "user", explicitUserAction: true },
          );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown identity error";
  process.stderr.write(`MemTextual Continuity identity failed: ${message}\n`);
  process.exitCode = 1;
}
