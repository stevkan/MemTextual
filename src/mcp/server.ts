import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { sourceKinds, sourceRecordKinds } from "../domain/ingestion.js";
import { memoryTypes } from "../domain/memory.js";
import type { IngestionService } from "../services/ingestion-service.js";
import type { MemoryService } from "../services/memory-service.js";

export const mcpServerName = "memtextual";
export const mcpServerVersion = "0.5.0";

const scopeKinds = ["global", "project", "conversation", "namespace"] as const;
const sensitivities = ["normal", "sensitive", "restricted"] as const;
const retrievalPolicies = ["include", "exclude", "manual"] as const;
const explicitnessValues = ["explicit", "inferred"] as const;
const revisionChangeKinds = ["edited", "reaffirmed", "corrected"] as const;
const candidateStatuses = ["pending", "accepted", "rejected"] as const;
const evidenceRoles = ["supports", "contradicts", "context"] as const;

const readOnlyAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const idempotentMutationAnnotations = {
  ...mutationAnnotations,
  idempotentHint: true,
} as const;

const destructiveAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
} as const;

type WithoutUndefined<T extends Record<string, unknown>> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key];
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<
    T[Key],
    undefined
  >;
};

function omitUndefined<T extends Record<string, unknown>>(
  value: T,
): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as WithoutUndefined<T>;
}

function successfulResult(value: unknown) {
  const structuredContent = { result: value };
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function runTool(operation: () => unknown) {
  try {
    return successfulResult(operation());
  } catch (error) {
    return errorResult(error);
  }
}

export function createMemTextualMcpServer(
  service: MemoryService,
  ingestionService?: IngestionService,
): McpServer {
  const server = new McpServer(
    { name: mcpServerName, version: mcpServerVersion },
    {
      instructions:
        "Store and retrieve local memories. Create or list scopes before creating memories. " +
        "Normal retrieval always requires caller-authorized scope IDs. MCP tools cannot modify protected memories or approve memory candidates.",
    },
  );

  server.registerTool(
    "scope_list",
    {
      title: "List memory scopes",
      description: "List every configured MemTextual scope.",
      annotations: readOnlyAnnotations,
    },
    async () => runTool(() => service.listScopes()),
  );

  server.registerTool(
    "scope_create",
    {
      title: "Create a memory scope",
      description:
        "Create a global, project, conversation, or namespace scope for memories.",
      inputSchema: z.object({
        kind: z.enum(scopeKinds),
        name: z.string().trim().min(1),
        externalKey: z.string().trim().min(1).optional(),
        parentScopeId: z.string().trim().min(1).optional(),
      }),
      annotations: mutationAnnotations,
    },
    async (input) => runTool(() => service.createScope(omitUndefined(input))),
  );

  server.registerTool(
    "memory_create",
    {
      title: "Create a memory",
      description: "Create a revisioned memory in one existing scope.",
      inputSchema: z.object({
        assertion: z.string().trim().min(1),
        type: z.enum(memoryTypes),
        scopeId: z.string().trim().min(1),
        sourceRecordId: z.string().trim().min(1).optional(),
        normalizedAssertion: z.string().trim().min(1).optional(),
        explicitness: z.enum(explicitnessValues).optional(),
        confidence: z.number().min(0).max(1).optional(),
        observedAt: z.string().trim().min(1).optional(),
        retrievalPolicy: z.enum(retrievalPolicies).optional(),
        sensitivity: z.enum(sensitivities).optional(),
        isPinned: z.boolean().optional(),
        isProtected: z.boolean().optional(),
      }),
      annotations: mutationAnnotations,
    },
    async (input) =>
      runTool(() =>
        service.create(omitUndefined({ ...input, createdBy: "system" as const })),
      ),
  );

  server.registerTool(
    "memory_get",
    {
      title: "Get a memory",
      description:
        "Get the current state of one memory by ID, including manual and excluded memories.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => runTool(() => service.getById(id)),
  );

  server.registerTool(
    "memory_history",
    {
      title: "Get memory history",
      description: "Get all immutable revisions for one memory in chronological order.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => runTool(() => service.getHistory(id)),
  );

  server.registerTool(
    "memory_retrieve",
    {
      title: "Retrieve memories",
      description:
        "Search active, included memories within caller-authorized scopes and sensitivities.",
      inputSchema: z.object({
        text: z.string().trim().min(1),
        scopeIds: z.array(z.string().trim().min(1)).min(1),
        allowedSensitivities: z.array(z.enum(sensitivities)).min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => runTool(() => service.retrieve(omitUndefined(input))),
  );

  server.registerTool(
    "memory_revise",
    {
      title: "Revise a memory",
      description:
        "Create a new revision of an unprotected active memory. Omitted metadata is inherited.",
      inputSchema: z.object({
        id: z.string().trim().min(1),
        assertion: z.string().trim().min(1),
        normalizedAssertion: z.string().trim().min(1).nullable().optional(),
        explicitness: z.enum(explicitnessValues).optional(),
        confidence: z.number().min(0).max(1).optional(),
        observedAt: z.string().trim().min(1).nullable().optional(),
        sourceRecordId: z.string().trim().min(1).optional(),
        changeKind: z.enum(revisionChangeKinds).optional(),
      }),
      annotations: mutationAnnotations,
    },
    async ({ id, ...input }) =>
      runTool(() =>
        service.revise(id, omitUndefined(input), { actor: "system" }),
      ),
  );

  server.registerTool(
    "memory_archive",
    {
      title: "Archive a memory",
      description: "Archive an unprotected active memory.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: destructiveAnnotations,
    },
    async ({ id }) =>
      runTool(() => service.archive(id, { actor: "system" })),
  );

  server.registerTool(
    "memory_restore",
    {
      title: "Restore a memory",
      description: "Restore an unprotected archived memory to active status.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: mutationAnnotations,
    },
    async ({ id }) =>
      runTool(() => service.restore(id, { actor: "system" })),
  );

  server.registerTool(
    "memory_supersede",
    {
      title: "Supersede a memory",
      description:
        "Mark an unprotected active memory as superseded by another active memory.",
      inputSchema: z.object({
        id: z.string().trim().min(1),
        replacementId: z.string().trim().min(1),
      }),
      annotations: destructiveAnnotations,
    },
    async ({ id, replacementId }) =>
      runTool(() =>
        service.supersede(id, replacementId, { actor: "system" }),
      ),
  );

  server.registerTool(
    "memory_contradict",
    {
      title: "Contradict a memory",
      description:
        "Mark an unprotected active memory as contradicted by another active memory.",
      inputSchema: z.object({
        id: z.string().trim().min(1),
        contradictingId: z.string().trim().min(1),
      }),
      annotations: destructiveAnnotations,
    },
    async ({ id, contradictingId }) =>
      runTool(() =>
        service.contradict(id, contradictingId, { actor: "system" }),
      ),
  );

  if (ingestionService !== undefined) {
    registerIngestionTools(server, ingestionService);
  }

  return server;
}

function registerIngestionTools(
  server: McpServer,
  service: IngestionService,
): void {
  const metadataSchema = z.record(z.string(), z.unknown());

  server.registerTool(
    "source_import",
    {
      title: "Import a source",
      description:
        "Atomically import an ordered source and its records. Repeated identical imports are idempotent.",
      inputSchema: z.object({
        kind: z.enum(sourceKinds),
        title: z.string().trim().min(1),
        originUri: z.string().trim().min(1).optional(),
        externalId: z.string().trim().min(1).optional(),
        capturedAt: z.string().trim().min(1).optional(),
        metadata: metadataSchema.optional(),
        records: z.array(
          z.object({
            kind: z.enum(sourceRecordKinds),
            content: z.string().min(1),
            authorRole: z.string().trim().min(1).optional(),
            authorName: z.string().trim().min(1).optional(),
            occurredAt: z.string().trim().min(1).optional(),
            metadata: metadataSchema.optional(),
          }),
        ).min(1),
      }),
      annotations: idempotentMutationAnnotations,
    },
    async (input) =>
      runTool(() =>
        service.importSource(
          omitUndefined({
            ...input,
            records: input.records.map((record) => omitUndefined(record)),
          }),
        ),
      ),
  );

  server.registerTool(
    "source_list",
    {
      title: "List imported sources",
      description: "List recent non-deleted sources and their record counts.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ limit }) => runTool(() => service.listSources(limit)),
  );

  server.registerTool(
    "source_records",
    {
      title: "Get source records",
      description: "Get the ordered records belonging to one imported source.",
      inputSchema: z.object({ sourceId: z.string().trim().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ sourceId }) => runTool(() => service.getSourceRecords(sourceId)),
  );

  server.registerTool(
    "source_record_get",
    {
      title: "Get a source record",
      description:
        "Get one source record by ID so candidate evidence can be inspected in full.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => runTool(() => service.getSourceRecord(id)),
  );

  server.registerTool(
    "candidate_propose",
    {
      title: "Propose a memory candidate",
      description:
        "Create a pending memory candidate linked to one or more source records. This does not approve or store a memory.",
      inputSchema: z.object({
        assertion: z.string().trim().min(1),
        type: z.enum(memoryTypes),
        scopeId: z.string().trim().min(1),
        evidence: z.array(
          z.object({
            sourceRecordId: z.string().trim().min(1),
            role: z.enum(evidenceRoles).optional(),
            excerpt: z.string().min(1).optional(),
          }),
        ).min(1),
        normalizedAssertion: z.string().trim().min(1).optional(),
        explicitness: z.enum(explicitnessValues).optional(),
        confidence: z.number().min(0).max(1).optional(),
        observedAt: z.string().trim().min(1).optional(),
        retrievalPolicy: z.enum(retrievalPolicies).optional(),
        sensitivity: z.enum(sensitivities).optional(),
        isPinned: z.boolean().optional(),
        isProtected: z.boolean().optional(),
        metadata: metadataSchema.optional(),
      }),
      annotations: mutationAnnotations,
    },
    async (input) =>
      runTool(() =>
        service.proposeCandidate(
          omitUndefined({
            ...input,
            proposedBy: "system" as const,
            evidence: input.evidence.map((evidence) => omitUndefined(evidence)),
          }),
        ),
      ),
  );

  server.registerTool(
    "candidate_get",
    {
      title: "Get a memory candidate",
      description: "Get one candidate with its evidence and review state.",
      inputSchema: z.object({ id: z.string().trim().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => runTool(() => service.getCandidate(id)),
  );

  server.registerTool(
    "candidate_list",
    {
      title: "List memory candidates",
      description:
        "List candidates, optionally filtered by review status. Approval is available only through an explicit user-authorized interface.",
      inputSchema: z.object({
        status: z.enum(candidateStatuses).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ status, limit }) =>
      runTool(() => service.listCandidates(status, limit)),
  );
}
