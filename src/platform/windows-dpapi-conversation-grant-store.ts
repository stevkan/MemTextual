import type {
  ConversationGrantBinding,
  ConversationGrantStore,
  ConversationGrantStoreReceipt,
  StoreConversationGrantInput,
} from "../domain/conversation-grant-store.js";
import type { WindowsPowerShellBridge } from "./windows-powershell-host-operations.js";

export interface WindowsDpapiConversationGrantStoreOptions {
  bridge: WindowsPowerShellBridge;
}

export class WindowsDpapiConversationGrantStore
  implements ConversationGrantStore
{
  readonly #bridge: WindowsPowerShellBridge;

  public constructor(options: WindowsDpapiConversationGrantStoreOptions) {
    this.#bridge = options.bridge;
  }

  public async store(
    input: StoreConversationGrantInput,
  ): Promise<ConversationGrantStoreReceipt> {
    const normalized = normalizeStoredGrant(input);
    const response = requireRecord(
      await this.#bridge.execute("store-conversation-grant", normalized),
      "store",
    );
    if (
      response.stored !== true ||
      typeof response.created !== "boolean" ||
      response.authorizationId !== normalized.authorizationId ||
      Object.keys(response).some(
        (key) =>
          key !== "authorizationId" && key !== "created" && key !== "stored",
      )
    ) {
      throw new Error("Windows protected grant store response is invalid.");
    }
    return {
      authorizationId: normalized.authorizationId,
      created: response.created,
    };
  }

  public async load(binding: ConversationGrantBinding): Promise<string | null> {
    const normalized = normalizeBinding(binding);
    const response = requireRecord(
      await this.#bridge.execute("load-conversation-grant", normalized),
      "load",
    );
    if (response.found === false) {
      if (Object.keys(response).length !== 1) {
        throw new Error("Windows protected grant lookup response is invalid.");
      }
      return null;
    }
    if (
      response.found !== true ||
      typeof response.grant !== "string" ||
      !isGrant(response.grant) ||
      Object.keys(response).some((key) => key !== "found" && key !== "grant")
    ) {
      throw new Error("Windows protected grant lookup response is invalid.");
    }
    return response.grant;
  }

  public async delete(binding: ConversationGrantBinding): Promise<boolean> {
    const normalized = normalizeBinding(binding);
    const response = requireRecord(
      await this.#bridge.execute("delete-conversation-grant", normalized),
      "delete",
    );
    if (
      typeof response.deleted !== "boolean" ||
      response.authorizationId !== normalized.authorizationId ||
      Object.keys(response).some(
        (key) => key !== "deleted" && key !== "authorizationId",
      )
    ) {
      throw new Error("Windows protected grant deletion response is invalid.");
    }
    return response.deleted;
  }
}

function requireRecord(value: unknown, operation: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Windows protected grant ${operation} response must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: string, label: string, maximum = 500): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`Conversation grant ${label} is invalid.`);
  }
  return normalized;
}

function normalizeBinding(
  binding: ConversationGrantBinding,
): ConversationGrantBinding {
  const authorizationId = requiredText(
    binding.authorizationId,
    "authorizationId",
    200,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(authorizationId)) {
    throw new Error("Conversation grant authorizationId is invalid.");
  }
  return {
    authorizationId,
    userId: requiredText(binding.userId, "userId"),
    personaId: requiredText(binding.personaId, "personaId"),
    relationshipId: requiredText(binding.relationshipId, "relationshipId"),
    hostId: requiredText(binding.hostId, "hostId", 200),
  };
}

function normalizeStoredGrant(
  input: StoreConversationGrantInput,
): StoreConversationGrantInput {
  if (!isGrant(input.grant)) {
    throw new Error("Conversation grant value is invalid.");
  }
  return { ...normalizeBinding(input), grant: input.grant };
}

function isGrant(value: string): boolean {
  return /^mthg_[A-Za-z0-9_-]{43}$/u.test(value);
}
