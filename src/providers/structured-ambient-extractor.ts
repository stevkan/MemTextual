import { z } from "zod";
import { personaMemoryClasses } from "../domain/continuity-memory.js";
import type {
  AmbientExtractionInput,
  AmbientExtractionProvider,
  AmbientMemoryExtractor,
  AmbientMemoryProposal,
} from "../domain/ambient-memory.js";
import { memoryTypes } from "../domain/memory.js";

const evidenceSchema = z
  .object({
    sourceRecordId: z.string().trim().min(1).max(512),
    role: z.enum(["supports", "contradicts", "context"]).optional(),
    excerpt: z.string().min(1).max(10_000).optional(),
  })
  .strict();

const proposalSchema = z
  .object({
    assertion: z.string().trim().min(1).max(10_000),
    type: z.enum(memoryTypes),
    memoryClass: z.enum(personaMemoryClasses),
    evidence: z.array(evidenceSchema).min(1).max(100),
    normalizedAssertion: z.string().max(10_000).optional(),
    explicitness: z.enum(["explicit", "inferred"]).optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
    observedAt: z.string().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    reviewAfter: z.string().optional(),
    retrievalPolicy: z.enum(["include", "exclude", "manual"]).optional(),
    sensitivity: z.enum(["normal", "sensitive", "restricted"]).optional(),
    isPinned: z.boolean().optional(),
    isProtected: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .transform((proposal) => {
    if (proposal.type !== "task_context" || proposal.memoryClass === "episodic") {
      return proposal;
    }
    return {
      ...proposal,
      memoryClass: "episodic" as const,
      metadata: {
        ...(proposal.metadata ?? {}),
        classificationNormalization: {
          rule: "task_context_is_episodic",
          originalMemoryClass: proposal.memoryClass,
        },
      },
    };
  });

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error(`${label} must contain between 1 and 200 characters.`);
  }
  return normalized;
}

function parseProviderOutput(output: unknown): unknown {
  if (typeof output !== "string") {
    return output;
  }
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error("The extraction provider returned invalid JSON.");
  }
}

export interface StructuredAmbientExtractorOptions {
  maximumProposals?: number;
}

export class StructuredAmbientMemoryExtractor implements AmbientMemoryExtractor {
  public readonly id: string;
  public readonly version: string;
  private readonly maximumProposals: number;

  public constructor(
    private readonly provider: AmbientExtractionProvider,
    options: StructuredAmbientExtractorOptions = {},
  ) {
    this.id = requiredIdentity(provider.id, "An extraction provider ID");
    this.version = requiredIdentity(
      provider.version,
      "An extraction provider version",
    );
    const maximumProposals = options.maximumProposals ?? 50;
    if (
      !Number.isSafeInteger(maximumProposals) ||
      maximumProposals < 1 ||
      maximumProposals > 500
    ) {
      throw new Error("maximumProposals must be an integer from 1 through 500.");
    }
    this.maximumProposals = maximumProposals;
  }

  public async extract(
    input: AmbientExtractionInput,
  ): Promise<AmbientMemoryProposal[]> {
    const raw = parseProviderOutput(await this.provider.extract(input));
    const parsed = z
      .object({
        proposals: z.array(proposalSchema).max(this.maximumProposals),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Extraction provider output failed validation: ${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data.proposals as AmbientMemoryProposal[];
  }
}
