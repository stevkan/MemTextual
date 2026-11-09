import * as z from "zod/v4";
import { personaMemoryClasses } from "../domain/continuity-memory.js";
import { memoryStatuses, memoryTypes } from "../domain/memory.js";

export const continuityMcpContractVersion = 2;
export const continuityMcpServerName = "memtextual-continuity";
export const continuityMcpReadScope = "continuity.read";
export const continuityMcpWriteScope = "continuity.write";

export const continuityMcpServerInstructions =
  "MemTextual Continuity manages private, persona-bound memory. Ordinary ChatGPT provides explicit tool calls only; never claim passive capture. Resolve the intended persona with persona_list or persona_get before a persona-bound action. Use persona_memory_remember only when the user explicitly asks to remember, save, or store information. Never request or infer user, relationship, or scope IDs; the server resolves those boundaries.";

export type ContinuityToolAuthorization =
  | "authenticated_read"
  | "explicit_user_write"
  | "explicit_user_destructive_write";

export interface ContinuityToolAnnotations {
  readOnlyHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
  destructiveHint: boolean;
}

export interface ContinuityMcpToolContract {
  name: string;
  title: string;
  description: string;
  authorization: ContinuityToolAuthorization;
  requiredScopes: readonly [string, ...string[]];
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  annotations: ContinuityToolAnnotations;
  openaiProfile?: true;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const destructiveWriteAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
} as const;

const emptyInputSchema = z.object({}).strict();
const personaIdSchema = z.uuid();
const memoryIdSchema = z.uuid();
const candidateIdSchema = z.uuid();
const nonemptyTextSchema = z.string().trim().min(1);
const sensitivitySchema = z.enum(["normal", "sensitive", "restricted"]);
const retrievalPolicySchema = z.enum(["include", "exclude", "manual"]);
const candidateStatusSchema = z.enum(["pending", "accepted", "rejected"]);
const readScopes = [continuityMcpReadScope] as const;
const writeScopes = [continuityMcpWriteScope] as const;

export const continuityProfileSchema = z
  .object({
    id: nonemptyTextSchema,
    name: z.string().optional(),
    email: z.string().optional(),
    nickname: z.string().optional(),
  })
  .strict();

export const continuityPersonaSummarySchema = z
  .object({
    id: personaIdSchema,
    name: nonemptyTextSchema,
    description: z.string().nullable(),
    relationshipName: nonemptyTextSchema,
    createdAt: nonemptyTextSchema,
    updatedAt: nonemptyTextSchema,
  })
  .strict();

export const continuityPersonaBehaviorSchema = z
  .object({
    id: z.uuid(),
    personaId: personaIdSchema,
    revisionNumber: z.number().int().positive(),
    instructions: nonemptyTextSchema,
    enabled: z.boolean(),
    note: z.string().nullable(),
    createdAt: nonemptyTextSchema,
  })
  .strict();

export const continuityPersonaMemorySummarySchema = z
  .object({
    id: memoryIdSchema,
    personaId: personaIdSchema,
    assertion: nonemptyTextSchema,
    memoryClass: z.enum(personaMemoryClasses),
    type: z.enum(memoryTypes),
    status: z.enum(memoryStatuses),
    sensitivity: sensitivitySchema,
    retrievalPolicy: retrievalPolicySchema,
    isPinned: z.boolean(),
    isProtected: z.boolean(),
    revisionNumber: z.number().int().positive(),
    createdAt: nonemptyTextSchema,
    updatedAt: nonemptyTextSchema,
  })
  .strict();

export const continuityCandidateSummarySchema = z
  .object({
    id: candidateIdSchema,
    personaId: personaIdSchema,
    assertion: nonemptyTextSchema,
    memoryClass: z.enum(personaMemoryClasses),
    type: z.enum(memoryTypes),
    status: candidateStatusSchema,
    sensitivity: sensitivitySchema,
    confidence: z.number().min(0).max(1),
    createdAt: nonemptyTextSchema,
  })
  .strict();

const personaResultSchema = z.object({ persona: continuityPersonaSummarySchema }).strict();
const memoryResultSchema = z
  .object({ memory: continuityPersonaMemorySummarySchema })
  .strict();
const candidateResultSchema = z
  .object({ candidate: continuityCandidateSummarySchema })
  .strict();

const personaUpdateInputSchema = z
  .object({
    personaId: personaIdSchema,
    expectedUpdatedAt: nonemptyTextSchema,
    name: nonemptyTextSchema.optional(),
    description: nonemptyTextSchema.nullable().optional(),
    relationshipName: nonemptyTextSchema.optional(),
  })
  .strict()
  .refine(
    ({ name, description, relationshipName }) =>
      name !== undefined || description !== undefined || relationshipName !== undefined,
    { message: "At least one persona field must be supplied." },
  );

const personaMemoryIdInputSchema = z
  .object({
    personaId: personaIdSchema,
    memoryId: memoryIdSchema,
  })
  .strict();

const personaCandidateIdInputSchema = z
  .object({
    personaId: personaIdSchema,
    candidateId: candidateIdSchema,
  })
  .strict();

export const continuityMcpToolCatalog = [
  {
    name: "continuity_profile",
    title: "Get the connected Continuity profile",
    description:
      "Return the stable Continuity profile represented by the authenticated connection so ChatGPT can identify and distinguish connected accounts.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: emptyInputSchema,
    outputSchema: continuityProfileSchema,
    annotations: readOnlyAnnotations,
    openaiProfile: true,
  },
  {
    name: "persona_list",
    title: "List Continuity personas",
    description:
      "Use this when the user wants to see their personas or when a persona name must be resolved before another action.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: emptyInputSchema,
    outputSchema: z.object({ personas: z.array(continuityPersonaSummarySchema) }).strict(),
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_get",
    title: "Get a Continuity persona",
    description:
      "Use this to inspect one persona owned by the authenticated Continuity user.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: z.object({ personaId: personaIdSchema }).strict(),
    outputSchema: personaResultSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_create",
    title: "Create a Continuity persona",
    description:
      "Use this only when the user explicitly asks to create a new Continuity persona. User and scope identities are resolved by the server.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        name: nonemptyTextSchema,
        description: nonemptyTextSchema.optional(),
        relationshipName: nonemptyTextSchema.optional(),
      })
      .strict(),
    outputSchema: personaResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_update",
    title: "Update a Continuity persona",
    description:
      "Use this only when the user explicitly asks to change mutable persona or relationship details. Ownership and scope identities never change.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: personaUpdateInputSchema,
    outputSchema: personaResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_behavior_get",
    title: "Get persona behavior",
    description:
      "Use this to inspect the current user-authored behavior instructions for one Continuity persona.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: z.object({ personaId: personaIdSchema }).strict(),
    outputSchema: z
      .object({ behavior: continuityPersonaBehaviorSchema.nullable() })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_behavior_update",
    title: "Update persona behavior",
    description:
      "Use this only when the user explicitly asks to create, change, enable, or disable a persona's behavior instructions.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        expectedRevisionNumber: z.number().int().nonnegative().nullable(),
        instructions: nonemptyTextSchema,
        enabled: z.boolean(),
        note: nonemptyTextSchema.optional(),
      })
      .strict(),
    outputSchema: z.object({ behavior: continuityPersonaBehaviorSchema }).strict(),
    annotations: writeAnnotations,
  },
  {
    name: "persona_memory_remember",
    title: "Remember information for a persona",
    description:
      "Use this only when the user explicitly asks MemTextual to remember, save, or store the supplied information for one persona. Never use it for implicit capture.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        assertion: nonemptyTextSchema,
        memoryClass: z.enum(personaMemoryClasses),
        type: z.enum(memoryTypes),
        requestedSensitivity: sensitivitySchema.optional(),
        retrievalPolicy: retrievalPolicySchema.optional(),
        isPinned: z.boolean().optional(),
        isProtected: z.boolean().optional(),
      })
      .strict(),
    outputSchema: memoryResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_memory_search",
    title: "Search persona memories",
    description:
      "Use this to retrieve relevant active memories for one persona without accepting caller-selected scopes or sensitivity expansion.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        text: nonemptyTextSchema,
        memoryClasses: z.array(z.enum(personaMemoryClasses)).min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    outputSchema: z
      .object({ memories: z.array(continuityPersonaMemorySummarySchema) })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_memory_list",
    title: "List persona memories",
    description:
      "Use this when the user wants to inspect memories belonging to one persona.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        memoryClass: z.enum(personaMemoryClasses).optional(),
      })
      .strict(),
    outputSchema: z
      .object({ memories: z.array(continuityPersonaMemorySummarySchema) })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_memory_get",
    title: "Get a persona memory",
    description:
      "Use this to inspect one memory and its current revision for the specified persona.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: personaMemoryIdInputSchema,
    outputSchema: memoryResultSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_memory_revise",
    title: "Revise a persona memory",
    description:
      "Use this only when the user explicitly asks to correct or update an existing memory for the same persona.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        memoryId: memoryIdSchema,
        assertion: nonemptyTextSchema,
        changeKind: z.enum(["edited", "reaffirmed", "corrected"]).optional(),
      })
      .strict(),
    outputSchema: memoryResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_memory_archive",
    title: "Archive a persona memory",
    description:
      "Use this only when the user explicitly asks to remove an active memory from normal retrieval while keeping it recoverable.",
    authorization: "explicit_user_destructive_write",
    requiredScopes: writeScopes,
    inputSchema: personaMemoryIdInputSchema,
    outputSchema: memoryResultSchema,
    annotations: destructiveWriteAnnotations,
  },
  {
    name: "persona_memory_restore",
    title: "Restore an archived persona memory",
    description:
      "Use this only when the user explicitly asks to return an archived memory to active retrieval.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: personaMemoryIdInputSchema,
    outputSchema: memoryResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_candidate_list",
    title: "List persona memory candidates",
    description:
      "Use this when the user wants to inspect review candidates associated with one persona.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        status: candidateStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    outputSchema: z
      .object({ candidates: z.array(continuityCandidateSummarySchema) })
      .strict(),
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_candidate_get",
    title: "Get a persona memory candidate",
    description:
      "Use this to inspect one candidate and its review evidence for the specified persona.",
    authorization: "authenticated_read",
    requiredScopes: readScopes,
    inputSchema: personaCandidateIdInputSchema,
    outputSchema: candidateResultSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "persona_candidate_accept",
    title: "Accept a persona memory candidate",
    description:
      "Use this only when the user explicitly asks to accept a pending candidate as a new memory for the same persona.",
    authorization: "explicit_user_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        candidateId: candidateIdSchema,
        note: nonemptyTextSchema.optional(),
      })
      .strict(),
    outputSchema: memoryResultSchema,
    annotations: writeAnnotations,
  },
  {
    name: "persona_candidate_ignore",
    title: "Ignore a persona memory candidate",
    description:
      "Use this only when the user explicitly asks to resolve a pending candidate without creating or changing a memory.",
    authorization: "explicit_user_destructive_write",
    requiredScopes: writeScopes,
    inputSchema: z
      .object({
        personaId: personaIdSchema,
        candidateId: candidateIdSchema,
        note: nonemptyTextSchema.optional(),
      })
      .strict(),
    outputSchema: candidateResultSchema,
    annotations: destructiveWriteAnnotations,
  },
] as const satisfies readonly ContinuityMcpToolContract[];

export const continuityMcpExcludedOperations = [
  "passive_chatgpt_turn_capture",
  "caller_selected_user_relationship_or_scope",
  "persona_deletion",
  "memory_recoverable_deletion",
  "memory_permanent_purge",
  "conversation_journal_purge",
  "host_authorization_management",
] as const;
