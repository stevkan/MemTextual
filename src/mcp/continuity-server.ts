import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { PersonaMemory, PersonaMemoryClass } from "../domain/continuity-memory.js";
import type { MemoryCandidate } from "../domain/ingestion.js";
import type { MemoryType, Sensitivity } from "../domain/memory.js";
import type { PersonaContext } from "../domain/persona.js";
import type { PersonaBehaviorProfile } from "../domain/continuity-persona-behavior.js";
import type {
  ContinuityAuthenticatedPersonaService,
  ContinuityAuthenticatedPrincipal,
} from "../services/continuity-authenticated-persona-service.js";
import type { ContinuityControlService } from "../services/continuity-control-service.js";
import type { ContinuityMemoryService } from "../services/continuity-memory-service.js";
import type { ContinuityPersonaBehaviorService } from "../services/continuity-persona-behavior-service.js";
import {
  continuityMcpContractVersion,
  continuityMcpServerInstructions,
  continuityMcpServerName,
  continuityMcpToolCatalog,
  type ContinuityMcpToolContract,
} from "./continuity-contract.js";

export interface ContinuityMcpInvocationAuthorization {
  principal: ContinuityAuthenticatedPrincipal;
  explicitUserAction: boolean;
}

export interface ContinuityMcpServerCallContext {
  http?: {
    authInfo?: unknown;
  };
}

export interface ContinuityMcpAuthorizationResolver {
  resolve(
    context: ContinuityMcpServerCallContext,
  ):
    | ContinuityMcpInvocationAuthorization
    | Promise<ContinuityMcpInvocationAuthorization>;
}

export interface ContinuityExplicitMemorySensitivityInput {
  principal: ContinuityAuthenticatedPrincipal;
  persona: PersonaContext;
  assertion: string;
  memoryClass: PersonaMemoryClass;
  type: MemoryType;
  requestedSensitivity?: Sensitivity;
}

export interface ContinuityExplicitMemorySensitivityAssessment {
  sensitivity: Sensitivity;
  confidence: number;
  reasonCodes: string[];
}

export interface ContinuityExplicitMemorySensitivityAssessor {
  assess(
    input: ContinuityExplicitMemorySensitivityInput,
  ):
    | ContinuityExplicitMemorySensitivityAssessment
    | Promise<ContinuityExplicitMemorySensitivityAssessment>;
}

export interface ContinuityMcpServerDependencies {
  authorization: ContinuityMcpAuthorizationResolver;
  personas: ContinuityAuthenticatedPersonaService;
  behaviors: ContinuityPersonaBehaviorService;
  control: ContinuityControlService;
  memories: ContinuityMemoryService;
  sensitivity: ContinuityExplicitMemorySensitivityAssessor;
}

export class ExplicitContinuityMcpUserActionRequiredError extends Error {
  public constructor() {
    super("This Continuity operation requires an explicit user action.");
    this.name = "ExplicitContinuityMcpUserActionRequiredError";
  }
}

const sensitivityRank: Record<Sensitivity, number> = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
};

const sensitivityAssessmentSchema = z
  .object({
    sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    confidence: z.number().min(0).max(1),
    reasonCodes: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

type ToolInput = Record<string, unknown>;
type ToolOutput = Record<string, unknown>;

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

function successfulResult(value: ToolOutput) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function runTool(operation: () => ToolOutput | Promise<ToolOutput>) {
  try {
    return successfulResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

function requireExplicitUserAction(
  tool: ContinuityMcpToolContract,
  authorization: ContinuityMcpInvocationAuthorization,
): void {
  if (
    tool.authorization !== "authenticated_read" &&
    authorization.explicitUserAction !== true
  ) {
    throw new ExplicitContinuityMcpUserActionRequiredError();
  }
}

function maximumSensitivity(
  assessed: Sensitivity,
  requested: Sensitivity | undefined,
): Sensitivity {
  if (requested === undefined || sensitivityRank[assessed] >= sensitivityRank[requested]) {
    return assessed;
  }
  return requested;
}

function personaSummary(context: PersonaContext) {
  return {
    id: context.persona.id,
    name: context.persona.name,
    description: context.persona.description,
    relationshipName: context.relationship.name,
    createdAt: context.persona.createdAt,
    updatedAt: context.persona.updatedAt,
  };
}

function memorySummary(personaMemory: PersonaMemory) {
  const { memory } = personaMemory;
  return {
    id: memory.id,
    personaId: personaMemory.personaId,
    assertion: memory.assertion,
    memoryClass: personaMemory.memoryClass,
    type: memory.type,
    status: memory.status,
    sensitivity: memory.sensitivity,
    retrievalPolicy: memory.retrievalPolicy,
    isPinned: memory.isPinned,
    isProtected: memory.isProtected,
    revisionNumber: memory.revisionNumber,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

function behaviorSummary(profile: PersonaBehaviorProfile) {
  return {
    id: profile.id,
    personaId: profile.personaId,
    revisionNumber: profile.revisionNumber,
    instructions: profile.instructions,
    enabled: profile.enabled,
    note: profile.note,
    createdAt: profile.createdAt,
  };
}

function candidateSummary(
  candidate: MemoryCandidate,
  memoryClass: PersonaMemoryClass,
  personaId: string,
) {
  return {
    id: candidate.id,
    personaId,
    assertion: candidate.assertion,
    memoryClass,
    type: candidate.type,
    status: candidate.status,
    sensitivity: candidate.sensitivity,
    confidence: candidate.confidence,
    createdAt: candidate.createdAt,
  };
}

function requiredString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Missing Continuity tool input: ${key}`);
  }
  return value;
}

function optionalString(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function requiredBoolean(input: ToolInput, key: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") {
    throw new Error(`Missing Continuity tool input: ${key}`);
  }
  return value;
}

function optionalBoolean(input: ToolInput, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function requiredNumber(input: ToolInput, key: string): number {
  const value = input[key];
  if (typeof value !== "number") {
    throw new Error(`Missing Continuity tool input: ${key}`);
  }
  return value;
}

function optionalNumber(input: ToolInput, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

async function executeTool(
  tool: ContinuityMcpToolContract,
  rawInput: unknown,
  callContext: ContinuityMcpServerCallContext,
  dependencies: ContinuityMcpServerDependencies,
): Promise<ToolOutput> {
  const input = tool.inputSchema.parse(rawInput) as ToolInput;
  const authorization = await dependencies.authorization.resolve(callContext);
  requireExplicitUserAction(tool, authorization);
  const { principal } = authorization;

  switch (tool.name) {
    case "continuity_profile": {
      const user = dependencies.personas.getProfile(principal);
      const personaCount = dependencies.personas.listPersonas(principal).length;
      return {
        user: { id: user.id, displayName: user.displayName },
        personaCount,
        passiveCaptureAvailable: false,
        captureMode: "explicit_tool_calls_only",
      };
    }
    case "persona_list":
      return {
        personas: dependencies.personas.listPersonas(principal).map(personaSummary),
      };
    case "persona_get":
      return {
        persona: personaSummary(
          dependencies.personas.getPersona(principal, requiredString(input, "personaId")),
        ),
      };
    case "persona_create":
      return {
        persona: personaSummary(
          dependencies.personas.createPersona(
            principal,
            omitUndefined({
              name: requiredString(input, "name"),
              description: optionalString(input, "description"),
              relationshipName: optionalString(input, "relationshipName"),
            }),
          ),
        ),
      };
    case "persona_update":
      return {
        persona: personaSummary(
          dependencies.personas.updatePersona(
            principal,
            omitUndefined({
              personaId: requiredString(input, "personaId"),
              expectedUpdatedAt: requiredString(input, "expectedUpdatedAt"),
              name: optionalString(input, "name"),
              description: input["description"] as string | null | undefined,
              relationshipName: optionalString(input, "relationshipName"),
            }),
          ),
        ),
      };
    case "persona_behavior_get": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const behavior = dependencies.behaviors.getProfile(personaId);
      return { behavior: behavior === null ? null : behaviorSummary(behavior) };
    }
    case "persona_behavior_update": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      return {
        behavior: behaviorSummary(
          dependencies.behaviors.configureProfile(
            omitUndefined({
              personaId,
              expectedRevisionNumber:
                input["expectedRevisionNumber"] === null
                  ? null
                  : requiredNumber(input, "expectedRevisionNumber"),
              instructions: requiredString(input, "instructions"),
              enabled: requiredBoolean(input, "enabled"),
              note: optionalString(input, "note"),
            }),
            { actor: "user", explicitUserAction: true },
          ),
        ),
      };
    }
    case "persona_memory_remember": {
      const personaId = requiredString(input, "personaId");
      const persona = dependencies.personas.getPersona(principal, personaId);
      const assertion = requiredString(input, "assertion");
      const memoryClass = requiredString(input, "memoryClass") as PersonaMemoryClass;
      const type = requiredString(input, "type") as MemoryType;
      const requestedSensitivity = optionalString(
        input,
        "requestedSensitivity",
      ) as Sensitivity | undefined;
      const assessment = sensitivityAssessmentSchema.parse(
        await dependencies.sensitivity.assess(
          omitUndefined({
            principal,
            persona,
            assertion,
            memoryClass,
            type,
            requestedSensitivity,
          }),
        ),
      );
      return {
        memory: memorySummary(
          dependencies.control.createMemory(
            omitUndefined({
              personaId,
              assertion,
              memoryClass,
              type,
              explicitness: "explicit" as const,
              confidence: 1,
              sensitivity: maximumSensitivity(
                assessment.sensitivity,
                requestedSensitivity,
              ),
              retrievalPolicy: optionalString(input, "retrievalPolicy") as
                | "include"
                | "exclude"
                | "manual"
                | undefined,
              isPinned: optionalBoolean(input, "isPinned"),
              isProtected: optionalBoolean(input, "isProtected"),
            }),
            { actor: "user", explicitUserAction: true },
          ),
        ),
      };
    }
    case "persona_memory_search": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      return {
        memories: dependencies.memories
          .retrieve(
            omitUndefined({
              personaId,
              text: requiredString(input, "text"),
              memoryClasses: input["memoryClasses"] as PersonaMemoryClass[] | undefined,
              limit: optionalNumber(input, "limit"),
            }),
          )
          .map(({ personaMemory }) => memorySummary(personaMemory)),
      };
    }
    case "persona_memory_list": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      return {
        memories: dependencies.control
          .listMemories(
            personaId,
            optionalString(input, "memoryClass") as PersonaMemoryClass | undefined,
          )
          .map(memorySummary),
      };
    }
    case "persona_memory_get": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      return {
        memory: memorySummary(
          dependencies.control.getMemoryDetail(
            personaId,
            requiredString(input, "memoryId"),
          ).personaMemory,
        ),
      };
    }
    case "persona_memory_revise": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const memoryId = requiredString(input, "memoryId");
      dependencies.control.reviseMemory(
        {
          personaId,
          memoryId,
          revision: omitUndefined({
            assertion: requiredString(input, "assertion"),
            explicitness: "explicit" as const,
            confidence: 1,
            changeKind: optionalString(input, "changeKind") as
              | "edited"
              | "reaffirmed"
              | "corrected"
              | undefined,
          }),
        },
        { actor: "user", explicitUserAction: true },
      );
      return {
        memory: memorySummary(
          dependencies.control.getMemoryDetail(personaId, memoryId).personaMemory,
        ),
      };
    }
    case "persona_memory_archive":
    case "persona_memory_restore": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const memoryId = requiredString(input, "memoryId");
      if (tool.name === "persona_memory_archive") {
        dependencies.control.archiveMemory(personaId, memoryId, {
          actor: "user",
          explicitUserAction: true,
        });
      } else {
        dependencies.control.restoreMemory(personaId, memoryId, {
          actor: "user",
          explicitUserAction: true,
        });
      }
      return {
        memory: memorySummary(
          dependencies.control.getMemoryDetail(personaId, memoryId).personaMemory,
        ),
      };
    }
    case "persona_candidate_list": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      return {
        candidates: dependencies.control
          .listCandidateQueue(
            omitUndefined({
              personaId,
              status: optionalString(input, "status") as
                | "pending"
                | "accepted"
                | "rejected"
                | undefined,
              limit: optionalNumber(input, "limit"),
            }),
          )
          .map(({ candidate, memoryClass }) =>
            candidateSummary(candidate, memoryClass, personaId),
          ),
      };
    }
    case "persona_candidate_get": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const review = dependencies.control.getCandidateReview(
        personaId,
        requiredString(input, "candidateId"),
      );
      return {
        candidate: candidateSummary(
          review.candidate,
          review.memoryClass,
          personaId,
        ),
      };
    }
    case "persona_candidate_accept": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const result = dependencies.control.resolveCandidate(
        {
          personaId,
          candidateId: requiredString(input, "candidateId"),
          resolution: { outcome: "create" },
        },
        omitUndefined({
          actor: "user" as const,
          explicitUserAction: true,
          note: optionalString(input, "note"),
        }),
      );
      if (result.memory === null) {
        throw new Error("The accepted Continuity candidate did not create a memory.");
      }
      return {
        memory: memorySummary(
          dependencies.control.getMemoryDetail(personaId, result.memory.id).personaMemory,
        ),
      };
    }
    case "persona_candidate_ignore": {
      const personaId = requiredString(input, "personaId");
      dependencies.personas.getPersona(principal, personaId);
      const result = dependencies.control.resolveCandidate(
        {
          personaId,
          candidateId: requiredString(input, "candidateId"),
          resolution: { outcome: "ignore" },
        },
        omitUndefined({
          actor: "user" as const,
          explicitUserAction: true,
          note: optionalString(input, "note"),
        }),
      );
      return {
        candidate: candidateSummary(
          result.candidate,
          dependencies.control.getCandidateReview(
            personaId,
            result.candidate.id,
          ).memoryClass,
          personaId,
        ),
      };
    }
    default:
      throw new Error(`Unsupported Continuity MCP tool: ${tool.name}`);
  }
}

export function createContinuityMcpServer(
  dependencies: ContinuityMcpServerDependencies,
): McpServer {
  const server = new McpServer(
    {
      name: continuityMcpServerName,
      version: `0.8.0-contract.${continuityMcpContractVersion}`,
    },
    { instructions: continuityMcpServerInstructions },
  );

  for (const tool of continuityMcpToolCatalog) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (input: unknown, context: ContinuityMcpServerCallContext) =>
        runTool(() => executeTool(tool, input, context, dependencies)),
    );
  }

  return server;
}
