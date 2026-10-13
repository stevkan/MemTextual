import type {
  CreateMemoryInput,
  CreateScopeInput,
  DeleteMemoryInput,
  Memory,
  MemoryActor,
  MemoryMutationContext,
  MemoryPurgePreview,
  MemoryPurgeReceipt,
  PurgeMemoryInput,
  MemoryRevision,
  RetrievalQuery,
  RetrievalResult,
  ReviseMemoryInput,
  Scope,
} from "../domain/memory.js";
import type { MemoryRepository } from "../repositories/memory-repository.js";

export class MemoryNotFoundError extends Error {
  public constructor(id: string) {
    super(`Memory not found: ${id}`);
    this.name = "MemoryNotFoundError";
  }
}

export class ProtectedMemoryError extends Error {
  public constructor(id: string) {
    super(
      `Memory ${id} is protected. An explicit user action is required to modify it.`,
    );
    this.name = "ProtectedMemoryError";
  }
}

export class ExplicitUserActionRequiredError extends Error {
  public constructor(operation: string) {
    super(`${operation} requires an explicit user action.`);
    this.name = "ExplicitUserActionRequiredError";
  }
}

export class MemoryService {
  public constructor(private readonly repository: MemoryRepository) {}

  public createScope(input: CreateScopeInput): Scope {
    return this.repository.createScope(input);
  }

  public listScopes(): Scope[] {
    return this.repository.listScopes();
  }

  public create(input: CreateMemoryInput): Memory {
    return this.repository.create(input);
  }

  public getById(id: string): Memory | null {
    return this.repository.getById(id);
  }

  public getHistory(id: string): MemoryRevision[] {
    this.requireMemory(id);
    return this.repository.getHistory(id);
  }

  public setPinned(
    id: string,
    pinned: boolean,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const explicitUserAction = this.requireExplicitUserAction(
      pinned ? "Memory pinning" : "Memory unpinning",
      actor,
      context,
    );
    this.requireMemory(id);
    return this.repository.setPinned(id, pinned, actor, explicitUserAction);
  }

  public setProtected(
    id: string,
    protected_: boolean,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const explicitUserAction = this.requireExplicitUserAction(
      protected_ ? "Memory protection" : "Memory unprotection",
      actor,
      context,
    );
    this.requireMemory(id);
    return this.repository.setProtected(
      id,
      protected_,
      actor,
      explicitUserAction,
    );
  }

  public revise(
    id: string,
    input: ReviseMemoryInput,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const allowProtected = this.authorizeMutation(id, actor, context);
    return this.repository.revise(id, input, actor, allowProtected);
  }

  public archive(
    id: string,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const allowProtected = this.authorizeMutation(id, actor, context);
    return this.repository.archive(id, actor, allowProtected);
  }

  public restore(
    id: string,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const allowProtected = this.authorizeMutation(id, actor, context);
    return this.repository.restore(id, actor, allowProtected);
  }

  public delete(
    id: string,
    input: DeleteMemoryInput,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const explicitUserAction = this.requireExplicitUserAction("Memory deletion", actor, context);
    this.requireMemory(id);
    return this.repository.delete(id, input, actor, explicitUserAction);
  }

  public restoreDeleted(
    id: string,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const explicitUserAction = this.requireExplicitUserAction(
      "Deleted-memory restoration",
      actor,
      context,
    );
    this.requireMemory(id);
    return this.repository.restoreDeleted(id, actor, explicitUserAction);
  }

  public previewPurge(id: string): MemoryPurgePreview {
    this.requireMemory(id);
    return this.repository.previewPurge(id);
  }

  public purge(
    id: string,
    input: PurgeMemoryInput,
    context: MemoryMutationContext = {},
  ): MemoryPurgeReceipt {
    const actor = context.actor ?? "system";
    const explicitUserAction = this.requireExplicitUserAction("Memory purge", actor, context);
    if (input.confirmation !== id) {
      throw new Error("Memory purge confirmation must exactly match the memory ID.");
    }
    this.requireMemory(id);
    return this.repository.purge(id, input.reason, actor, explicitUserAction);
  }

  public supersede(
    id: string,
    replacementId: string,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const allowProtected = this.authorizeMutation(id, actor, context);
    this.requireMemory(replacementId);
    return this.repository.supersede(
      id,
      replacementId,
      actor,
      allowProtected,
    );
  }

  public contradict(
    id: string,
    contradictingId: string,
    context: MemoryMutationContext = {},
  ): Memory {
    const actor = context.actor ?? "system";
    const allowProtected = this.authorizeMutation(id, actor, context);
    this.requireMemory(contradictingId);
    return this.repository.contradict(
      id,
      contradictingId,
      actor,
      allowProtected,
    );
  }

  public retrieve(query: RetrievalQuery): RetrievalResult[] {
    return this.repository.retrieve(query);
  }

  private authorizeMutation(
    id: string,
    actor: MemoryActor,
    context: MemoryMutationContext,
  ): boolean {
    const memory = this.requireMemory(id);
    const explicitUserAction =
      actor === "user" && context.explicitUserAction === true;

    if (memory.isProtected && !explicitUserAction) {
      throw new ProtectedMemoryError(id);
    }

    return explicitUserAction;
  }

  private requireExplicitUserAction(
    operation: string,
    actor: MemoryActor,
    context: MemoryMutationContext,
  ): true {
    if (actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitUserActionRequiredError(operation);
    }
    return true;
  }

  private requireMemory(id: string): Memory {
    const memory = this.repository.getById(id);
    if (memory === null) {
      throw new MemoryNotFoundError(id);
    }
    return memory;
  }
}
