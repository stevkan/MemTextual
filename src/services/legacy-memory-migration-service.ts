import * as z from "zod/v4";
import type {
  LegacyMemoryEntry,
  LegacyMemoryExport,
  LegacyMemoryMigrationOptions,
  LegacyMemoryMigrationResult,
} from "../domain/legacy-migration.js";
import { memoryTypes } from "../domain/memory.js";
import type { Scope } from "../domain/memory.js";
import type { IngestionService } from "./ingestion-service.js";

const metadataSchema = z.record(z.string(), z.unknown());
const nonemptyText = z.string().trim().min(1);
const preservedNonemptyText = z.string().refine(
  (value) => value.trim().length > 0,
  "Text cannot be empty.",
);

const legacyMemoryEntrySchema = z.object({
  id: nonemptyText,
  assertion: preservedNonemptyText,
  type: z.enum(memoryTypes).optional(),
  scopeId: nonemptyText.optional(),
  normalizedAssertion: nonemptyText.optional(),
  explicitness: z.enum(["explicit", "inferred"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  observedAt: nonemptyText.optional(),
  createdAt: nonemptyText.optional(),
  retrievalPolicy: z.enum(["include", "exclude", "manual"]).optional(),
  sensitivity: z.enum(["normal", "sensitive", "restricted"]).optional(),
  isPinned: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  authorRole: nonemptyText.optional(),
  authorName: nonemptyText.optional(),
  metadata: metadataSchema.optional(),
}).strict();

const legacyMemoryExportSchema = z.object({
  formatVersion: z.literal(1),
  source: z.object({
    title: nonemptyText,
    originSystem: nonemptyText,
    externalId: nonemptyText,
    originUri: nonemptyText.optional(),
    exportedAt: nonemptyText.optional(),
    metadata: metadataSchema.optional(),
  }).strict(),
  memories: z.array(legacyMemoryEntrySchema).min(1),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, memory] of value.memories.entries()) {
    if (ids.has(memory.id)) {
      context.addIssue({
        code: "custom",
        message: `Legacy memory IDs must be unique; duplicate ID: ${memory.id}`,
        path: ["memories", index, "id"],
      });
    }
    ids.add(memory.id);
  }
});

export function parseLegacyMemoryExport(value: unknown): LegacyMemoryExport {
  return legacyMemoryExportSchema.parse(value) as LegacyMemoryExport;
}

function encodeIdentityPart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function createLegacyCandidateExternalId(
  sourceExternalId: string,
  legacyMemoryId: string,
): string {
  return `legacy:${encodeIdentityPart(sourceExternalId)}:${encodeIdentityPart(legacyMemoryId)}`;
}

export interface LegacyMigrationScopeReader {
  listScopes(): Scope[];
}

function requireScopeId(
  memory: LegacyMemoryEntry,
  defaultScopeId: string | undefined,
): string {
  const scopeId = memory.scopeId?.trim() ?? defaultScopeId?.trim();
  if (scopeId === undefined || scopeId.length === 0) {
    throw new Error(
      `Legacy memory ${memory.id} requires scopeId or the migration requires a default scope.`,
    );
  }
  return scopeId;
}

export class LegacyMemoryMigrationService {
  public constructor(
    private readonly ingestion: IngestionService,
    private readonly scopes: LegacyMigrationScopeReader,
  ) {}

  public migrate(
    input: LegacyMemoryExport,
    options: LegacyMemoryMigrationOptions = {},
  ): LegacyMemoryMigrationResult {
    const parsed = parseLegacyMemoryExport(input);
    const scopeIds = parsed.memories.map((memory) =>
      requireScopeId(memory, options.defaultScopeId),
    );
    const availableScopeIds = new Set(this.scopes.listScopes().map(({ id }) => id));
    const missingScopeIds = [...new Set(scopeIds)].filter(
      (scopeId) => !availableScopeIds.has(scopeId),
    );
    if (missingScopeIds.length > 0) {
      throw new Error(
        `Legacy migration scopes do not exist: ${missingScopeIds.join(", ")}.`,
      );
    }
    const sourceImport = this.ingestion.importSource({
      kind: "app",
      title: parsed.source.title,
      externalId: parsed.source.externalId,
      ...(parsed.source.originUri === undefined
        ? {}
        : { originUri: parsed.source.originUri }),
      ...(parsed.source.exportedAt === undefined
        ? {}
        : { capturedAt: parsed.source.exportedAt }),
      metadata: {
        legacyMigration: {
          formatVersion: parsed.formatVersion,
          originSystem: parsed.source.originSystem,
        },
        legacyMetadata: parsed.source.metadata ?? {},
      },
      records: parsed.memories.map((memory) => ({
        kind: "entry" as const,
        content: memory.assertion,
        ...(memory.authorRole === undefined
          ? {}
          : { authorRole: memory.authorRole }),
        ...(memory.authorName === undefined
          ? {}
          : { authorName: memory.authorName }),
        ...(memory.createdAt === undefined && memory.observedAt === undefined
          ? {}
          : { occurredAt: memory.createdAt ?? memory.observedAt }),
        metadata: {
          legacyMemoryId: memory.id,
          legacyMetadata: memory.metadata ?? {},
        },
      })),
    });

    if (sourceImport.records.length !== parsed.memories.length) {
      throw new Error("The imported legacy source record count is inconsistent.");
    }

    const items = parsed.memories.map((memory, index) => {
      const record = sourceImport.records[index];
      if (record === undefined) {
        throw new Error(`Missing source record for legacy memory ${memory.id}.`);
      }
      const externalId = createLegacyCandidateExternalId(
        parsed.source.externalId,
        memory.id,
      );
      const existing = this.ingestion.getCandidateByExternalId(externalId);
      const candidate = this.ingestion.proposeCandidate(
        {
          externalId,
          assertion: memory.assertion,
          type: memory.type ?? "other",
          scopeId: scopeIds[index]!,
          evidence: [{ sourceRecordId: record.id, role: "supports" }],
          ...(memory.normalizedAssertion === undefined
            ? {}
            : { normalizedAssertion: memory.normalizedAssertion }),
          explicitness: memory.explicitness ?? "inferred",
          confidence: memory.confidence ?? 0.5,
          ...(memory.observedAt === undefined
            ? {}
            : { observedAt: memory.observedAt }),
          retrievalPolicy: memory.retrievalPolicy ?? "include",
          sensitivity: memory.sensitivity ?? "normal",
          isPinned: memory.isPinned ?? false,
          isProtected: memory.isProtected ?? false,
          proposedBy: "import",
          metadata: {
            requiresManualReview: true,
            legacyMigration: {
              formatVersion: parsed.formatVersion,
              originSystem: parsed.source.originSystem,
              sourceExternalId: parsed.source.externalId,
              legacyMemoryId: memory.id,
              legacyCreatedAt: memory.createdAt ?? null,
            },
            legacyMetadata: memory.metadata ?? {},
          },
        },
        { processAutomation: false },
      );
      return {
        legacyMemoryId: memory.id,
        candidateId: candidate.id,
        candidateExternalId: externalId,
        status: candidate.status,
        created: existing === null,
      };
    });

    return {
      sourceId: sourceImport.source.id,
      sourceExternalId: parsed.source.externalId,
      sourceCreated: sourceImport.created,
      items,
      summary: {
        created: items.filter(({ created }) => created).length,
        reused: items.filter(({ created }) => !created).length,
        pending: items.filter(({ status }) => status === "pending").length,
        accepted: items.filter(({ status }) => status === "accepted").length,
        rejected: items.filter(({ status }) => status === "rejected").length,
      },
    };
  }
}
