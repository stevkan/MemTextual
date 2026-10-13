import type {
  CreateMemoryInput,
  CreateScopeInput,
  DeleteMemoryInput,
  Memory,
  MemoryActor,
  MemoryPurgePreview,
  MemoryPurgeReceipt,
  MemoryRevision,
  RetrievalQuery,
  RetrievalResult,
  ReviseMemoryInput,
  Scope,
} from "../domain/memory.js";

export interface MemoryRepository {
  createScope(input: CreateScopeInput): Scope;
  listScopes(): Scope[];
  create(input: CreateMemoryInput): Memory;
  getById(id: string): Memory | null;
  getHistory(id: string): MemoryRevision[];
  revise(id: string, input: ReviseMemoryInput, actor: MemoryActor, allowProtected: boolean): Memory;
  archive(id: string, actor: MemoryActor, allowProtected: boolean): Memory;
  restore(id: string, actor: MemoryActor, allowProtected: boolean): Memory;
  delete(id: string, input: DeleteMemoryInput, actor: MemoryActor, explicitUserAction: boolean): Memory;
  restoreDeleted(id: string, actor: MemoryActor, explicitUserAction: boolean): Memory;
  previewPurge(id: string): MemoryPurgePreview;
  purge(id: string, reason: string, actor: MemoryActor, explicitUserAction: boolean): MemoryPurgeReceipt;
  supersede(id: string, replacementId: string, actor: MemoryActor, allowProtected: boolean): Memory;
  contradict(id: string, contradictingId: string, actor: MemoryActor, allowProtected: boolean): Memory;
  retrieve(query: RetrievalQuery): RetrievalResult[];
  search(query: string, limit?: number): Memory[];
}
