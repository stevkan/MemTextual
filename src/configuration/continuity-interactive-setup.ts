import { win32 } from "node:path";
import type { CodexAppServerModel } from "../hosts/codex-app-server-conversation-host.js";

export interface ContinuityInteractiveSetupInput {
  backupDirectory: string;
  extractionModel: string;
  personaDescription?: string;
  personaName: string;
  relationshipName?: string;
  userDisplayName: string;
}

export type ContinuitySetupQuestion = (prompt: string) => Promise<string>;

async function requiredAnswer(
  ask: ContinuitySetupQuestion,
  prompt: string,
): Promise<string> {
  while (true) {
    const value = (await ask(prompt)).trim();
    if (value.length > 0) {
      return value;
    }
  }
}

async function backupAnswer(
  ask: ContinuitySetupQuestion,
  defaultBackupDirectory: string,
): Promise<string> {
  while (true) {
    const value = (
      await ask(`Backup directory [${defaultBackupDirectory}]: `)
    ).trim();
    const selected = value || defaultBackupDirectory;
    if (win32.isAbsolute(selected)) {
      return win32.resolve(selected);
    }
  }
}

async function extractionModelAnswer(
  ask: ContinuitySetupQuestion,
  models: readonly CodexAppServerModel[],
): Promise<string> {
  if (models.length === 0) {
    throw new Error("Codex App Server returned no selectable models.");
  }
  const catalog = models.map((model, index) =>
    `${index + 1}. ${model.displayName} (${model.model})${model.isDefault ? " [Codex default]" : ""}`
  ).join("\n");
  while (true) {
    const value = (
      await ask(`${catalog}\nSelect the extraction model [1-${models.length}]: `)
    ).trim();
    if (!/^\d+$/u.test(value)) {
      continue;
    }
    const selected = models[Number(value) - 1];
    if (selected !== undefined) {
      return selected.model;
    }
  }
}

export async function collectContinuityInteractiveSetupInput(options: {
  ask: ContinuitySetupQuestion;
  dataRoot: string;
  extractionModel?: string;
  extractionModels?: readonly CodexAppServerModel[];
}): Promise<ContinuityInteractiveSetupInput> {
  if (
    options.extractionModel !== undefined &&
    options.extractionModels !== undefined
  ) {
    throw new Error(
      "Interactive setup cannot receive both an extraction model and a model catalog.",
    );
  }
  const userDisplayName = await requiredAnswer(
    options.ask,
    "Your display name: ",
  );
  const personaName = await requiredAnswer(
    options.ask,
    "Persona name: ",
  );
  const extractionModel = options.extractionModel === undefined
    ? options.extractionModels === undefined
      ? await requiredAnswer(options.ask, "Codex extraction model ID: ")
      : await extractionModelAnswer(options.ask, options.extractionModels)
    : options.extractionModel.trim();
  if (extractionModel.length === 0) {
    throw new Error("Extraction model must not be empty.");
  }
  const personaDescription = (
    await options.ask("Persona description (optional): ")
  ).trim();
  const relationshipName = (
    await options.ask("Relationship name (optional): ")
  ).trim();
  const backupDirectory = await backupAnswer(
    options.ask,
    win32.join(options.dataRoot, "backups"),
  );
  return {
    backupDirectory,
    extractionModel,
    ...(personaDescription.length > 0 ? { personaDescription } : {}),
    personaName,
    ...(relationshipName.length > 0 ? { relationshipName } : {}),
    userDisplayName,
  };
}
