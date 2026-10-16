import { createHash } from "node:crypto";
import {
  personaMemoryClasses,
  type PersonaMemoryClass,
} from "../domain/continuity-memory.js";
import type {
  AmbientCaptureResult,
  AmbientMemoryExtractor,
  AmbientMemoryProposal,
  AmbientSensitivityAssessment,
  AmbientSensitivityClassifier,
  AmbientSensitivityInput,
  CaptureAmbientInteractionInput,
} from "../domain/ambient-memory.js";
import type {
  AmbientSensitivityAssessmentContext,
  CandidateEvidenceInput,
  SourceRecord,
} from "../domain/ingestion.js";
import type { Sensitivity } from "../domain/memory.js";
import type { PersonaRepository } from "../repositories/persona-repository.js";
import type { IngestionService } from "./ingestion-service.js";
import {
  normalizeTemporalWindow,
  type NormalizedTemporalWindow,
} from "../temporal/temporal-relevance.js";

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
    const record = records.get(evidence.sourceRecordId);
    if (record === undefined) {
      throw new Error(
        "Ambient proposal evidence must reference the captured interaction.",
      );
    }
    if (
      evidence.excerpt !== undefined &&
      (evidence.excerpt.length === 0 || !record.content.includes(evidence.excerpt))
    ) {
      throw new Error(
        "Ambient proposal evidence excerpts must occur verbatim in the cited record.",
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
  sensitivityAssessment: AmbientSensitivityAssessmentContext,
  temporal: NormalizedTemporalWindow,
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
        sensitivityAssessment,
        temporal,
      }),
    )
    .digest("hex");
  return `ambient:${digest}`;
}

const sensitivityRank: Record<Sensitivity, number> = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
};

function validateSensitivity(value: Sensitivity): void {
  if (!(value in sensitivityRank)) {
    throw new Error(`Unsupported ambient sensitivity: ${String(value)}.`);
  }
}

function effectiveSensitivity(
  declared: Sensitivity | null,
  assessed: Sensitivity,
): Sensitivity {
  const declaredValue = declared ?? "normal";
  return sensitivityRank[declaredValue] >= sensitivityRank[assessed]
    ? declaredValue
    : assessed;
}

function normalizeReasonCodes(reasonCodes: string[]): string[] {
  if (
    !Array.isArray(reasonCodes) ||
    reasonCodes.length === 0 ||
    reasonCodes.some((code) => typeof code !== "string")
  ) {
    throw new Error("A sensitivity assessment requires at least one reason code.");
  }
  const normalized = [...new Set(reasonCodes.map((code) => code.trim()))].sort();
  if (
    normalized.some(
      (code) =>
        code.length === 0 ||
        code.length > 64 ||
        !/^[a-z0-9][a-z0-9._-]*$/iu.test(code),
    )
  ) {
    throw new Error(
      "Sensitivity reason codes must be short machine-readable identifiers.",
    );
  }
  return normalized;
}

function validateMemoryClass(memoryClass: PersonaMemoryClass): void {
  if (!personaMemoryClasses.includes(memoryClass)) {
    throw new Error(`Unsupported persona memory class: ${memoryClass}.`);
  }
}

function validateAssessment(
  classifier: AmbientSensitivityClassifier,
  assessment: AmbientSensitivityAssessment,
  declaredSensitivity: Sensitivity | null,
): AmbientSensitivityAssessmentContext {
  if (typeof assessment !== "object" || assessment === null) {
    throw new Error("A sensitivity classifier must return an assessment.");
  }
  validateSensitivity(assessment.sensitivity);
  if (
    !Number.isFinite(assessment.confidence) ||
    assessment.confidence < 0 ||
    assessment.confidence > 1
  ) {
    throw new Error(
      "Sensitivity assessment confidence must be between 0 and 1.",
    );
  }
  return {
    status: "assessed",
    declaredSensitivity,
    assessedSensitivity: assessment.sensitivity,
    confidence: assessment.confidence,
    classifierId: requiredText(
      classifier.id,
      "An ambient sensitivity classifier ID",
    ),
    classifierVersion: requiredText(
      classifier.version,
      "An ambient sensitivity classifier version",
    ),
    reasonCodes: normalizeReasonCodes(assessment.reasonCodes),
  };
}

async function classifySensitivity(
  classifier: AmbientSensitivityClassifier | undefined,
  inputs: AmbientSensitivityInput[],
  declaredSensitivities: Array<Sensitivity | null>,
): Promise<AmbientSensitivityAssessmentContext[]> {
  if (classifier === undefined) {
    return declaredSensitivities.map((declaredSensitivity) => ({
      status: "unassessed",
      declaredSensitivity,
      assessedSensitivity: "sensitive",
      confidence: 0,
      classifierId: "memtextual.unassessed",
      classifierVersion: "1",
      reasonCodes: ["classifier_unavailable"],
    }));
  }
  const assessments =
    classifier.classifyBatch === undefined
      ? await Promise.all(inputs.map((input) => classifier.classify(input)))
      : await classifier.classifyBatch(inputs);
  if (!Array.isArray(assessments) || assessments.length !== inputs.length) {
    throw new Error(
      "A sensitivity classifier must return one assessment per proposal.",
    );
  }
  return assessments.map((assessment, index) =>
    validateAssessment(classifier, assessment, declaredSensitivities[index]!),
  );
}

export class AmbientMemoryService {
  private readonly extractorId: string;
  private readonly extractorVersion: string;

  public constructor(
    private readonly ingestion: IngestionService,
    private readonly personas: PersonaRepository,
    private readonly extractor: AmbientMemoryExtractor,
    private readonly sensitivityClassifier?: AmbientSensitivityClassifier,
  ) {
    this.extractorId = requiredText(extractor.id, "An ambient extractor ID");
    this.extractorVersion = requiredText(
      extractor.version,
      "An ambient extractor version",
    );
    if (sensitivityClassifier !== undefined) {
      requiredText(
        sensitivityClassifier.id,
        "An ambient sensitivity classifier ID",
      );
      requiredText(
        sensitivityClassifier.version,
        "An ambient sensitivity classifier version",
      );
    }
  }

  public async captureInteraction(
    input: CaptureAmbientInteractionInput,
  ): Promise<AmbientCaptureResult> {
    const context = this.personas.getPersonaContext(input.personaId);
    if (context === null) {
      throw new Error(`Persona not found: ${input.personaId}`);
    }
    const imported = this.ingestion.importSource(input.source);
    const proposals = await this.extractor.extract({
      personaContext: context,
      source: imported.source,
      records: imported.records,
    });
    if (!Array.isArray(proposals)) {
      throw new Error("An ambient extractor must return an array of proposals.");
    }

    const records = new Map(imported.records.map((record) => [record.id, record]));
    const preparedProposals = proposals.map((proposal) => {
      validateMemoryClass(proposal.memoryClass);
      const evidence = validateEvidence(proposal, records);
      const declaredSensitivity = proposal.sensitivity ?? null;
      if (declaredSensitivity !== null) {
        validateSensitivity(declaredSensitivity);
      }
      const evidenceRecords = evidence.map(
        ({ sourceRecordId }) => records.get(sourceRecordId)!,
      );
      const sensitivityInput: AmbientSensitivityInput = {
        personaContext: context,
        source: imported.source,
        records: imported.records,
        proposal,
        evidenceRecords,
      };
      const temporal = normalizeTemporalWindow(proposal);
      return {
        proposal,
        evidence,
        declaredSensitivity,
        sensitivityInput,
        temporal,
      };
    });
    const sensitivityAssessments = await classifySensitivity(
      this.sensitivityClassifier,
      preparedProposals.map(({ sensitivityInput }) => sensitivityInput),
      preparedProposals.map(({ declaredSensitivity }) => declaredSensitivity),
    );
    const prepared = preparedProposals.map(
      ({ proposal, evidence, declaredSensitivity, temporal }, index) => {
        const sensitivityAssessment = sensitivityAssessments[index]!;
        const sensitivity = effectiveSensitivity(
          declaredSensitivity,
          sensitivityAssessment.assessedSensitivity,
        );
        const externalId = candidateExternalId(
          imported.source.id,
          this.extractorId,
          this.extractorVersion,
          proposal,
          sensitivityAssessment,
          temporal,
        );
        return {
          proposal,
          evidence,
          externalId,
          sensitivity,
          sensitivityAssessment,
          temporal,
        };
      },
    );

    let createdCandidateCount = 0;
    const candidates = prepared.map(
      ({
        proposal,
        evidence,
        externalId,
        sensitivity,
        sensitivityAssessment,
        temporal,
      }) => {
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
          ...(temporal.validFrom === null ? {} : { validFrom: temporal.validFrom }),
          ...(temporal.validTo === null ? {} : { validTo: temporal.validTo }),
          ...(temporal.reviewAfter === null
            ? {}
            : { reviewAfter: temporal.reviewAfter }),
          retrievalPolicy: proposal.retrievalPolicy ?? "include",
          sensitivity,
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
              sensitivityAssessment: {
                status: sensitivityAssessment.status,
                classifierId: sensitivityAssessment.classifierId,
                classifierVersion: sensitivityAssessment.classifierVersion,
                assessedSensitivity: sensitivityAssessment.assessedSensitivity,
                confidence: sensitivityAssessment.confidence,
                reasonCodes: sensitivityAssessment.reasonCodes,
              },
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
            sensitivityAssessment,
          },
        });
      },
    );

    return {
      source: imported.source,
      candidates,
      createdCandidateCount,
    };
  }
}
