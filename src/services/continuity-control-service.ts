import type {
  ContinuityCandidateQueueItem,
  ContinuityCandidateQueueQuery,
  ContinuityCandidateResolutionRequest,
  ContinuityCandidateReview,
  ContinuityControlMutationContext,
  ContinuityMemoryDeletionRequest,
  ContinuityMemoryDetail,
  ContinuityMemoryPurgeRequest,
  ContinuityMemoryRevisionRequest,
} from "../domain/continuity-control.js";
import type {
  CreatePersonaMemoryInput,
  PersonaMemory,
  PersonaMemoryClass,
} from "../domain/continuity-memory.js";
import type {
  CandidateResolutionResult,
  MemoryCandidate,
} from "../domain/ingestion.js";
import type {
  Memory,
  MemoryPurgePreview,
  MemoryPurgeReceipt,
} from "../domain/memory.js";
import type { ContinuityControlRepository } from "../repositories/continuity-control-repository.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import type { ContinuityMemoryService } from "./continuity-memory-service.js";
import type { IngestionService } from "./ingestion-service.js";
import type { MemoryService } from "./memory-service.js";

export class ExplicitContinuityControlActionRequiredError extends Error {
  public constructor() {
    super("Continuity control changes require an explicit user action.");
    this.name = "ExplicitContinuityControlActionRequiredError";
  }
}

export class ContinuityControlService {
  public constructor(
    private readonly repository: ContinuityControlRepository,
    private readonly personas: PersonaRepository,
    private readonly continuityMemories: ContinuityMemoryService,
    private readonly memories: MemoryService,
    private readonly ingestion: IngestionService,
  ) {}

  public listCandidateQueue(
    query: ContinuityCandidateQueueQuery,
  ): ContinuityCandidateQueueItem[] {
    this.requirePersona(query.personaId);
    return this.repository
      .listCandidateBindings(query.personaId, query.status, query.limit)
      .map((binding) => ({
        candidate: this.requireCandidate(binding.candidateId),
        memoryClass: binding.memoryClass,
      }));
  }

  public getCandidateReview(
    personaId: string,
    candidateId: string,
  ): ContinuityCandidateReview {
    const binding = this.requireCandidateBinding(personaId, candidateId);
    const candidate = this.requireCandidate(candidateId);
    const matches = this.ingestion
      .findCandidateMatches(candidateId)
      .filter(({ memory }) => {
        const profile = this.continuityMemories.getById(memory.id);
        return profile?.personaId === personaId;
      });
    return {
      candidate,
      memoryClass: binding.memoryClass,
      evidence: candidate.evidence.map((evidence) => ({
        evidence,
        record: this.ingestion.getSourceRecord(evidence.sourceRecordId),
      })),
      matches,
    };
  }

  public resolveCandidate(
    request: ContinuityCandidateResolutionRequest,
    context: ContinuityControlMutationContext = {},
  ): CandidateResolutionResult {
    this.requireExplicitUserAction(context);
    this.requireCandidateBinding(request.personaId, request.candidateId);
    if (request.resolution.targetMemoryId !== undefined) {
      this.requireMemory(request.personaId, request.resolution.targetMemoryId);
    }
    return this.ingestion.resolveCandidate(
      request.candidateId,
      request.resolution,
      this.reviewContext(context),
    );
  }

  public rejectCandidate(
    personaId: string,
    candidateId: string,
    context: ContinuityControlMutationContext = {},
  ): MemoryCandidate {
    this.requireExplicitUserAction(context);
    this.requireCandidateBinding(personaId, candidateId);
    return this.ingestion.rejectCandidate(
      candidateId,
      this.reviewContext(context),
    );
  }

  public createMemory(
    input: CreatePersonaMemoryInput,
    context: ContinuityControlMutationContext = {},
  ): PersonaMemory {
    this.requireExplicitUserAction(context);
    this.requirePersona(input.personaId);
    return this.continuityMemories.create({ ...input, createdBy: "user" });
  }

  public listMemories(
    personaId: string,
    memoryClass?: PersonaMemoryClass,
  ): PersonaMemory[] {
    this.requirePersona(personaId);
    return this.continuityMemories.listForPersona(personaId, memoryClass);
  }

  public getMemoryDetail(
    personaId: string,
    memoryId: string,
  ): ContinuityMemoryDetail {
    const personaMemory = this.requireMemory(personaId, memoryId);
    return {
      personaMemory,
      history: this.memories.getHistory(memoryId),
    };
  }

  public reviseMemory(
    request: ContinuityMemoryRevisionRequest,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(request.personaId, request.memoryId, context);
    return this.memories.revise(
      request.memoryId,
      request.revision,
      this.memoryContext(),
    );
  }

  public setPinned(
    personaId: string,
    memoryId: string,
    pinned: boolean,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    return this.memories.setPinned(
      memoryId,
      pinned,
      this.memoryContext(),
    );
  }

  public setProtected(
    personaId: string,
    memoryId: string,
    protected_: boolean,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    return this.memories.setProtected(
      memoryId,
      protected_,
      this.memoryContext(),
    );
  }

  public archiveMemory(
    personaId: string,
    memoryId: string,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    return this.memories.archive(memoryId, this.memoryContext());
  }

  public restoreMemory(
    personaId: string,
    memoryId: string,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    return this.memories.restore(memoryId, this.memoryContext());
  }

  public deleteMemory(
    request: ContinuityMemoryDeletionRequest,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(request.personaId, request.memoryId, context);
    return this.memories.delete(
      request.memoryId,
      request.deletion,
      this.memoryContext(),
    );
  }

  public restoreDeletedMemory(
    personaId: string,
    memoryId: string,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    return this.memories.restoreDeleted(
      memoryId,
      this.memoryContext(),
    );
  }

  public previewMemoryPurge(
    personaId: string,
    memoryId: string,
  ): MemoryPurgePreview {
    this.requireMemory(personaId, memoryId);
    return this.memories.previewPurge(memoryId);
  }

  public purgeMemory(
    request: ContinuityMemoryPurgeRequest,
    context: ContinuityControlMutationContext = {},
  ): MemoryPurgeReceipt {
    this.requireMemoryMutation(request.personaId, request.memoryId, context);
    return this.memories.purge(
      request.memoryId,
      request.purge,
      this.memoryContext(),
    );
  }

  public supersedeMemory(
    personaId: string,
    memoryId: string,
    replacementId: string,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    this.requireMemory(personaId, replacementId);
    return this.memories.supersede(
      memoryId,
      replacementId,
      this.memoryContext(),
    );
  }

  public contradictMemory(
    personaId: string,
    memoryId: string,
    contradictingId: string,
    context: ContinuityControlMutationContext = {},
  ): Memory {
    this.requireMemoryMutation(personaId, memoryId, context);
    this.requireMemory(personaId, contradictingId);
    return this.memories.contradict(
      memoryId,
      contradictingId,
      this.memoryContext(),
    );
  }

  private requireCandidateBinding(personaId: string, candidateId: string) {
    const persona = this.requirePersona(personaId);
    const binding = this.repository.getCandidateBinding(candidateId);
    if (
      binding === null ||
      binding.personaId !== persona.persona.id ||
      binding.userId !== persona.persona.userId ||
      binding.relationshipId !== persona.relationship.id
    ) {
      throw new Error(`Continuity candidate not found for persona: ${candidateId}`);
    }
    return binding;
  }

  private requireCandidate(candidateId: string): MemoryCandidate {
    const candidate = this.ingestion.getCandidate(candidateId);
    if (candidate === null) {
      throw new Error(`Continuity candidate not found: ${candidateId}`);
    }
    return candidate;
  }

  private requireMemory(personaId: string, memoryId: string): PersonaMemory {
    this.requirePersona(personaId);
    const memory = this.continuityMemories.getById(memoryId);
    if (memory === null || memory.personaId !== personaId) {
      throw new Error(`Continuity memory not found for persona: ${memoryId}`);
    }
    return memory;
  }

  private requirePersona(personaId: string) {
    const persona = this.personas.getPersonaContext(personaId);
    if (persona === null) {
      throw new Error(`Persona not found: ${personaId}`);
    }
    return persona;
  }

  private requireMemoryMutation(
    personaId: string,
    memoryId: string,
    context: ContinuityControlMutationContext,
  ): void {
    this.requireExplicitUserAction(context);
    this.requireMemory(personaId, memoryId);
  }

  private requireExplicitUserAction(
    context: ContinuityControlMutationContext,
  ): void {
    if (context.actor !== "user" || context.explicitUserAction !== true) {
      throw new ExplicitContinuityControlActionRequiredError();
    }
  }

  private memoryContext() {
    return { actor: "user" as const, explicitUserAction: true };
  }

  private reviewContext(context: ContinuityControlMutationContext) {
    return {
      actor: "user" as const,
      explicitUserAction: true,
      ...(context.note === undefined ? {} : { note: context.note }),
    };
  }
}
