import type {
  CreateMemoryInput,
  CreateScopeInput,
  Memory,
  MemoryActor,
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
  supersede(id: string, replacementId: string, actor: MemoryActor, allowProtected: boolean): Memory;
  contradict(id: string, contradictingId: string, actor: MemoryActor, allowProtected: boolean): Memory;
  retrieve(query: RetrievalQuery): RetrievalResult[];
  search(query: string, limit?: number): Memory[];
}
