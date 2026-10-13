import { createHash } from "node:crypto";
import {
  personaMemoryClasses,
  type PersonaMemoryClass,
} from "../domain/continuity-memory.js";
import type {
  AmbientCaptureResult,
  AmbientMemoryExtractor,
  AmbientMemoryProposal,
  CaptureAmbientInteractionInput,
} from "../domain/ambient-memory.js";
import type { CandidateEvidenceInput, SourceRecord } from "../domain/ingestion.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import type { IngestionService } from "./ingestion-service.js";

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return normalized;
}

function validateEvidence(
  proposal: AmbientMemoryProposal,
  records: Map<string, SourceRecord>,
): CandidateEvidenceInput[] {
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) {
    throw new Error("An ambient memory proposal requires evidence.");
  }
  for (const evidence of proposal.evidence) {
    if (!records.has(evidence.sourceRecordId)) {
      throw new Error(
        "Ambient proposal evidence must reference the captured interaction.",
      );
    }
  }
  return proposal.evidence;
}

function candidateExternalId(
  sourceId: string,
  extractorId: string,
  extractorVersion: string,
  proposal: AmbientMemoryProposal,
): string {
  const evidence = proposal.evidence
    .map((item) => ({
      sourceRecordId: item.sourceRecordId,
      role: item.role ?? "supports",
      excerpt: item.excerpt ?? null,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        sourceId,
        extractorId,
        extractorVersion,
        assertion: proposal.assertion.trim(),
        type: proposal.type,
        memoryClass: proposal.memoryClass,
        evidence,
      }),
    )
    .digest("hex");
  return `ambient:${digest}`;
}

function validateMemoryClass(memoryClass: PersonaMemoryClass): void {
  if (!personaMemoryClasses.includes(memoryClass)) {
    throw new Error(`Unsupported persona memory class: ${memoryClass}.`);
  }
}

export class AmbientMemoryService {
  private readonly extractorId: string;
  private readonly extractorVersion: string;

  public constructor(
    private readonly ingestion: IngestionService,
    private readonly personas: PersonaRepository,
    private readonly extractor: AmbientMemoryExtractor,
  ) {
    this.extractorId = requiredText(extractor.id, "An ambient extractor ID");
    this.extractorVersion = requiredText(
      extractor.version,
      "An ambient extractor version",
    );
  }

  public captureInteraction(
    input: CaptureAmbientInteractionInput,
  ): AmbientCaptureResult {
    const context = this.personas.getPersonaContext(input.personaId);
    if (context === null) {
      throw new Error(`Persona not found: ${input.personaId}`);
    }
    const imported = this.ingestion.importSource(input.source);
    const proposals = this.extractor.extract({
      personaContext: context,
      source: imported.source,
      records: imported.records,
    });
    if (!Array.isArray(proposals)) {
      throw new Error("An ambient extractor must return an array of proposals.");
    }

    const records = new Map(imported.records.map((record) => [record.id, record]));
    const prepared = proposals.map((proposal) => {
      validateMemoryClass(proposal.memoryClass);
      const evidence = validateEvidence(proposal, records);
      const externalId = candidateExternalId(
        imported.source.id,
        this.extractorId,
        this.extractorVersion,
        proposal,
      );
      return { proposal, evidence, externalId };
    });

    let createdCandidateCount = 0;
    const candidates = prepared.map(({ proposal, evidence, externalId }) => {
      if (this.ingestion.getCandidateByExternalId(externalId) === null) {
        createdCandidateCount += 1;
      }
      return this.ingestion.proposeCandidate({
        externalId,
        assertion: proposal.assertion,
        type: proposal.type,
        scopeId: context.relationship.scopeId,
        evidence,
        ...(proposal.normalizedAssertion === undefined
          ? {}
          : { normalizedAssertion: proposal.normalizedAssertion }),
        explicitness: proposal.explicitness ?? "inferred",
        confidence: proposal.confidence ?? 0.5,
        ...(proposal.observedAt === undefined
          ? {}
          : { observedAt: proposal.observedAt }),
        retrievalPolicy: proposal.retrievalPolicy ?? "include",
        sensitivity: proposal.sensitivity ?? "normal",
        isPinned: proposal.isPinned ?? false,
        isProtected: proposal.isProtected ?? false,
        proposedBy: "extractor",
        proposerId: this.extractorId,
        metadata: {
          ...(proposal.metadata ?? {}),
          ambientCapture: {
            extractorId: this.extractorId,
            extractorVersion: this.extractorVersion,
            personaId: context.persona.id,
            sourceId: imported.source.id,
          },
        },
        ambientContext: {
          sourceId: imported.source.id,
          userId: context.persona.userId,
          personaId: context.persona.id,
          relationshipId: context.relationship.id,
          memoryClass: proposal.memoryClass,
          extractorId: this.extractorId,
          extractorVersion: this.extractorVersion,
        },
      });
    });

    return {
      source: imported.source,
      candidates,
      createdCandidateCount,
    };
  }
}
