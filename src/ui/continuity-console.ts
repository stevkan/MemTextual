import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { conversationGrantBindingFromAuthorization } from "../domain/conversation-grant-store.js";
import {
  continuityConversationTurnEventKind,
  type ContinuityConversationJournaledTurnResult,
} from "../domain/continuity-conversation.js";
import type { ConversationHostIdentity } from "../domain/conversation-host.js";
import type { PersonaContext } from "../domain/persona.js";
import type { ContinuityControlService } from "../services/continuity-control-service.js";
import type { ContinuityConversationAuthorizationService } from "../services/continuity-conversation-authorization-service.js";
import type { ContinuityConversationCatalogService } from "../services/continuity-conversation-catalog-service.js";
import type { ContinuityConversationHostDeletionService } from "../services/continuity-conversation-host-deletion-service.js";
import type { ContinuityConversationJournalPrivacyService } from "../services/continuity-conversation-journal-privacy-service.js";
import { ContinuityConversationOpenRecoveryRequiredError } from "../services/continuity-conversation-client-coordinator.js";
import type { ContinuityConversationProtectedClient } from "../services/continuity-conversation-protected-client.js";
import { ContinuityConversationReconciliationCaptureError } from
  "../services/continuity-conversation-service.js";
import type { ContinuityPersonaBehaviorService } from "../services/continuity-persona-behavior-service.js";
import {
  continuityConsoleCss,
  continuityConsoleHtml,
  continuityConsoleJavaScript,
} from "./continuity-console-page.js";

const loopbackHost = "127.0.0.1";
const maximumBodyBytes = 64 * 1024;

const reviewSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.enum(["create", "ignore"]),
      note: z.string().max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      outcome: z.enum(["revise", "reaffirm", "contradict", "supersede"]),
      targetMemoryId: z.string().trim().min(1).max(500),
      note: z.string().max(10_000).optional(),
    })
    .strict(),
]);

const booleanValueSchema = z.object({ value: z.boolean() }).strict();
const emptySchema = z.object({}).strict();
const correctionSchema = z
  .object({ assertion: z.string().trim().min(1).max(50_000) })
  .strict();
const createMemorySchema = z
  .object({
    assertion: z.string().trim().min(1).max(50_000),
    memoryClass: z.enum(["episodic", "durable"]),
    type: z.enum([
      "preference",
      "fact",
      "decision",
      "entity",
      "task_context",
      "instruction",
      "goal",
      "relationship",
      "other",
    ]),
    sensitivity: z.enum(["normal", "sensitive", "restricted"]),
    retrievalPolicy: z.enum(["include", "exclude", "manual"]),
    isPinned: z.boolean(),
    isProtected: z.boolean(),
  })
  .strict();
const deletionSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
    confirmation: z.string().trim().min(1).max(500),
  })
  .strict();
const restorationSchema = z
  .object({ confirmation: z.string().trim().min(1).max(500) })
  .strict();
const purgeSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
    confirmation: z.string().trim().min(1).max(500),
    acknowledgePermanentRemoval: z.literal(true),
    acknowledgeExternalCopiesNotModified: z.literal(true),
  })
  .strict();
const personaBehaviorSchema = z
  .object({
    expectedRevisionNumber: z.number().int().positive().nullable(),
    instructions: z.string().min(1).max(50_000),
    enabled: z.boolean(),
    note: z.string().max(10_000).optional(),
  })
  .strict()
  .refine(({ instructions }) => instructions.trim().length > 0, {
    message: "Persona behavior instructions must not be empty.",
  });
const conversationAuthorizationSchema = z
  .object({ expiresAt: z.string().trim().min(1).max(100).optional() })
  .strict();
const conversationStartSchema = z
  .object({
    authorizationId: z.string().trim().min(1).max(500),
    model: z.string().trim().min(1).max(180).optional(),
  })
  .strict();
const conversationTurnSchema = z
  .object({ text: z.string().trim().min(1).max(50_000) })
  .strict();
const conversationHostDeletionSchema = z
  .object({
    confirmation: z.string().min(1).max(1_000),
    acknowledgeLocalDataRemains: z.boolean(),
    acknowledgeBackupsMayRemain: z.boolean(),
  })
  .strict();
const conversationJournalPurgeSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
    confirmation: z.string().min(1).max(1_000),
    acknowledgePermanentActiveDatabaseDeletion: z.boolean(),
    acknowledgeExternalCopiesMayRemain: z.boolean(),
  })
  .strict();

class HttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface StartContinuityConsoleOptions {
  behaviors: ContinuityPersonaBehaviorService;
  conversations: ContinuityConversationCatalogService;
  conversationPrivacy: ContinuityConversationJournalPrivacyService;
  control: ContinuityControlService;
  conversationRuntime?: ContinuityConsoleConversationRuntime;
  personaContext: PersonaContext;
  port?: number;
  token?: string;
}

export interface ContinuityConsoleConversationRuntime {
  authorizations: Pick<
    ContinuityConversationAuthorizationService,
    "authorize" | "listForPersona" | "revoke"
  >;
  client: Pick<
    ContinuityConversationProtectedClient,
    | "leaveConversation"
    | "openConversation"
    | "retryCapture"
    | "sendTurn"
    | "startConversation"
  >;
  hostDeletion: Pick<
    ContinuityConversationHostDeletionService,
    "deleteHostConversation" | "preview"
  >;
  hostIdentity: ConversationHostIdentity;
}

export interface ContinuityConsoleHandle {
  origin: string;
  launchUrl: string;
  token: string;
  close(): Promise<void>;
}

export interface ContinuityConsoleRequest {
  method: string;
  url: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

export interface ContinuityConsoleResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ContinuityConsoleApplication {
  handle(
    request: ContinuityConsoleRequest,
    origin: string,
  ): Promise<ContinuityConsoleResponse>;
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function textResponse(
  status: number,
  contentType: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): ContinuityConsoleResponse {
  return {
    status,
    headers: { ...securityHeaders(contentType), ...extraHeaders },
    body,
  };
}

function jsonResponse(
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): ContinuityConsoleResponse {
  return textResponse(
    status,
    "application/json; charset=utf-8",
    `${JSON.stringify(value)}\n`,
    extraHeaders,
  );
}

function jsonDownloadResponse(
  value: unknown,
  filename: string,
): ContinuityConsoleResponse {
  return textResponse(
    200,
    "application/json; charset=utf-8",
    `${JSON.stringify(value, null, 2)}\n`,
    { "Content-Disposition": `attachment; filename="${filename}"` },
  );
}

function safeTokenEqual(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireAuthorization(
  headers: Record<string, string | undefined>,
  token: string,
): void {
  const header = headers.authorization;
  const prefix = "Bearer ";
  if (
    header === undefined ||
    !header.startsWith(prefix) ||
    !safeTokenEqual(header.slice(prefix.length), token)
  ) {
    throw new HttpError(401, "Local console authorization was rejected.");
  }
}

function requireMutationOrigin(
  headers: Record<string, string | undefined>,
  origin: string,
): void {
  if (headers.origin !== origin) {
    throw new HttpError(403, "The request origin was rejected.");
  }
}

function readJson(
  request: ContinuityConsoleRequest,
  headers: Record<string, string | undefined>,
): unknown {
  const contentType = headers["content-type"];
  if (
    contentType === undefined ||
    !contentType.toLowerCase().startsWith("application/json")
  ) {
    throw new HttpError(415, "A JSON request body is required.");
  }
  const body = request.body ?? "";
  if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
    throw new HttpError(413, "The request body is too large.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "The request body failed validation.");
  }
  return result.data;
}

function routeId(
  pathname: string,
  suffix = "",
  resource = "(?:candidates|memories)",
): string | null {
  const expression = new RegExp(`^/api/${resource}/([^/]+)${suffix}$`, "u");
  const match = expression.exec(pathname);
  if (match?.[1] === undefined) {
    return null;
  }
  try {
    const id = decodeURIComponent(match[1]).trim();
    return id.length > 0 && id.length <= 500 ? id : null;
  } catch {
    return null;
  }
}

function conversationCaptureRoute(
  pathname: string,
): { captureId: string; conversationId: string } | null {
  const match =
    /^\/api\/conversations\/([^/]+)\/captures\/([^/]+)\/retry$/u.exec(pathname);
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  try {
    const conversationId = decodeURIComponent(match[1]).trim();
    const captureId = decodeURIComponent(match[2]).trim();
    if (
      conversationId.length === 0 ||
      conversationId.length > 500 ||
      captureId.length === 0 ||
      captureId.length > 500
    ) {
      return null;
    }
    return { captureId, conversationId };
  } catch {
    return null;
  }
}

function statusForError(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status;
  }
  if (error instanceof Error && /not found/iu.test(error.message)) {
    return 404;
  }
  return 400;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

function requireValidPort(port: number | undefined): number {
  const value = port ?? 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new Error("A Continuity console port must be an integer from 0 through 65535.");
  }
  return value;
}

function requireValidToken(token: string | undefined): string {
  const value = token ?? randomBytes(32).toString("base64url");
  if (value.length < 32 || value.length > 500) {
    throw new Error("A Continuity console token must contain 32 to 500 characters.");
  }
  return value;
}

function normalizedHeaders(
  headers: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function requireRequestHost(
  headers: Record<string, string | undefined>,
  origin: string,
): void {
  if (headers.host !== origin.slice("http://".length)) {
    throw new HttpError(421, "The request host was rejected.");
  }
}

function requireLoopbackOrigin(origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(500, "The console origin is invalid.");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== loopbackHost ||
    parsed.port.length === 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new HttpError(500, "The console origin must be an IPv4 loopback HTTP origin.");
  }
}

function requireExactConfirmation(confirmation: string, expected: string): void {
  if (confirmation !== expected) {
    throw new HttpError(400, "Confirmation must exactly match the memory ID.");
  }
}

function exportFilename(personaName: string): string {
  const slug = personaName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 80);
  return `memtextual-continuity-${slug || "persona"}-memories.json`;
}

function requireConversationRuntime(
  runtime: ContinuityConsoleConversationRuntime | undefined,
): ContinuityConsoleConversationRuntime {
  if (runtime === undefined) {
    throw new HttpError(503, "The Continuity conversation runtime is not enabled.");
  }
  return runtime;
}

function listPersonaHostAuthorizations(
  runtime: ContinuityConsoleConversationRuntime,
  persona: PersonaContext,
  includeRevoked = false,
) {
  return runtime.authorizations
    .listForPersona(persona, includeRevoked)
    .filter(({ hostId }) => hostId === runtime.hostIdentity.adapterId);
}

function conversationTurnResponse(result: ContinuityConversationJournaledTurnResult) {
  return {
    conversation: result.conversation,
    turn: result.turn,
    context: {
      formatVersion: result.context.payload.formatVersion,
      itemCount: result.context.payload.items.length,
      omittedCount: result.context.omittedCount,
    },
    captureRecord: result.captureRecord,
  };
}

export function createContinuityConsoleApplication(
  options: Pick<
    StartContinuityConsoleOptions,
    | "behaviors"
    | "conversations"
    | "conversationPrivacy"
    | "control"
    | "conversationRuntime"
    | "personaContext"
  >,
  token: string,
): ContinuityConsoleApplication {
  const expectedToken = requireValidToken(token);
  const personaId = options.personaContext.persona.id;
  options.control.listMemories(personaId);

  return {
    async handle(request, origin) {
      try {
        requireLoopbackOrigin(origin);
        const headers = normalizedHeaders(request.headers);
        requireRequestHost(headers, origin);
        const url = new URL(request.url, origin);
        if (url.origin !== origin) {
          throw new HttpError(421, "The request URL was rejected.");
        }

        if (request.method === "GET" && url.pathname === "/") {
          return textResponse(
            200,
            "text/html; charset=utf-8",
            continuityConsoleHtml,
            {
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            },
          );
        }
        if (request.method === "GET" && url.pathname === "/app.css") {
          return textResponse(200, "text/css; charset=utf-8", continuityConsoleCss);
        }
        if (request.method === "GET" && url.pathname === "/app.js") {
          return textResponse(
            200,
            "text/javascript; charset=utf-8",
            continuityConsoleJavaScript,
          );
        }
        if (!url.pathname.startsWith("/api/")) {
          throw new HttpError(404, "Not found.");
        }
        requireAuthorization(headers, expectedToken);

        if (request.method === "GET" && url.pathname === "/api/dashboard") {
          return jsonResponse(200, {
            persona: {
              id: options.personaContext.persona.id,
              name: options.personaContext.persona.name,
            },
            candidates: options.control.listCandidateQueue({
              personaId,
              status: "pending",
            }),
            memories: options.control.listMemories(personaId),
            conversations: options.conversations.listConversations(personaId),
            conversationRuntime: {
              enabled: options.conversationRuntime !== undefined,
            },
          });
        }

        if (
          request.method === "GET" &&
          url.pathname === "/api/conversation-authorizations"
        ) {
          const runtime = requireConversationRuntime(options.conversationRuntime);
          return jsonResponse(
            200,
            listPersonaHostAuthorizations(
              runtime,
              options.personaContext,
              true,
            ),
          );
        }

        if (request.method === "GET" && url.pathname === "/api/export") {
          return jsonDownloadResponse(
            options.control.exportPersonaMemories(personaId),
            exportFilename(options.personaContext.persona.name),
          );
        }

        if (request.method === "GET" && url.pathname === "/api/behavior") {
          return jsonResponse(200, {
            current: options.behaviors.getProfile(personaId),
            history: options.behaviors.listProfileHistory(personaId),
          });
        }

        const hostDeletionPreviewId = routeId(
          url.pathname,
          "/host-delete-preview",
          "conversations",
        );
        if (request.method === "GET" && hostDeletionPreviewId !== null) {
          const runtime = requireConversationRuntime(options.conversationRuntime);
          return jsonResponse(
            200,
            runtime.hostDeletion.preview(hostDeletionPreviewId, personaId),
          );
        }

        const journalPurgePreviewId = routeId(
          url.pathname,
          "/journal-purge-preview",
          "conversations",
        );
        if (request.method === "GET" && journalPurgePreviewId !== null) {
          return jsonResponse(
            200,
            options.conversationPrivacy.preview(journalPurgePreviewId, personaId),
          );
        }

        const conversationId = routeId(url.pathname, "", "conversations");
        if (request.method === "GET" && conversationId !== null) {
          return jsonResponse(
            200,
            options.conversations.getConversation(conversationId, personaId),
          );
        }

        const candidateId = routeId(url.pathname);
        if (
          request.method === "GET" &&
          candidateId !== null &&
          url.pathname.startsWith("/api/candidates/")
        ) {
          return jsonResponse(
            200,
            options.control.getCandidateReview(personaId, candidateId),
          );
        }

        const memoryId = routeId(url.pathname);
        if (
          request.method === "GET" &&
          memoryId !== null &&
          url.pathname.startsWith("/api/memories/")
        ) {
          return jsonResponse(
            200,
            options.control.getMemoryDetail(personaId, memoryId),
          );
        }

        const purgePreviewId = routeId(url.pathname, "/purge-preview");
        if (
          request.method === "GET" &&
          purgePreviewId !== null &&
          url.pathname.startsWith("/api/memories/")
        ) {
          return jsonResponse(
            200,
            options.control.previewMemoryPurge(personaId, purgePreviewId),
          );
        }

        if (request.method !== "POST") {
          throw new HttpError(405, "Method not allowed.");
        }
        requireMutationOrigin(headers, origin);
        const body = readJson(request, headers);
        if (url.pathname === "/api/conversation-authorizations") {
          const runtime = requireConversationRuntime(options.conversationRuntime);
          const input = parseBody(conversationAuthorizationSchema, body);
          return jsonResponse(
            201,
            await runtime.authorizations.authorize(
              {
                userId: options.personaContext.persona.userId,
                personaId,
                hostId: runtime.hostIdentity.adapterId,
                allowedEventKinds: [continuityConversationTurnEventKind],
                ...(input.expiresAt === undefined
                  ? {}
                  : { expiresAt: input.expiresAt }),
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        const revokeAuthorizationId = routeId(
          url.pathname,
          "/revoke",
          "conversation-authorizations",
        );
        if (revokeAuthorizationId !== null) {
          parseBody(emptySchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          const authorization = listPersonaHostAuthorizations(
            runtime,
            options.personaContext,
            true,
          ).find(({ id }) => id === revokeAuthorizationId);
          if (authorization === undefined) {
            throw new HttpError(404, "Host authorization not found.");
          }
          return jsonResponse(
            200,
            await runtime.authorizations.revoke(
              conversationGrantBindingFromAuthorization(authorization),
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        if (url.pathname === "/api/conversations") {
          const runtime = requireConversationRuntime(options.conversationRuntime);
          const input = parseBody(conversationStartSchema, body);
          return jsonResponse(
            201,
            await runtime.client.startConversation({
              personaId,
              authorizationId: input.authorizationId,
              ...(input.model === undefined ? {} : { model: input.model }),
            }),
          );
        }
        const openConversationId = routeId(
          url.pathname,
          "/open",
          "conversations",
        );
        if (openConversationId !== null) {
          parseBody(emptySchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          try {
            return jsonResponse(
              200,
              await runtime.client.openConversation({
                conversationId: openConversationId,
                personaId,
              }),
            );
          } catch (error) {
            if (error instanceof ContinuityConversationOpenRecoveryRequiredError) {
              return jsonResponse(409, {
                status: "recovery_required",
                conversationId: error.conversationId,
                captures: error.captures,
              });
            }
            if (error instanceof ContinuityConversationReconciliationCaptureError) {
              return jsonResponse(409, {
                status: "reconciliation_capture_failed",
                conversation: error.conversation,
                turn: error.turn,
                captureRecord: error.captureRecord,
              });
            }
            throw error;
          }
        }
        const conversationTurnId = routeId(
          url.pathname,
          "/turns",
          "conversations",
        );
        if (conversationTurnId !== null) {
          const input = parseBody(conversationTurnSchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          return jsonResponse(
            200,
            conversationTurnResponse(
              await runtime.client.sendTurn({
                conversationId: conversationTurnId,
                personaId,
                text: input.text,
              }),
            ),
          );
        }
        const captureRetry = conversationCaptureRoute(url.pathname);
        if (captureRetry !== null) {
          parseBody(emptySchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          return jsonResponse(
            200,
            await runtime.client.retryCapture({
              ...captureRetry,
              personaId,
            }),
          );
        }
        const leaveConversationId = routeId(
          url.pathname,
          "/leave",
          "conversations",
        );
        if (leaveConversationId !== null) {
          parseBody(emptySchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          runtime.client.leaveConversation(leaveConversationId, personaId);
          return jsonResponse(200, {
            conversationId: leaveConversationId,
            left: true,
          });
        }
        const hostDeletionId = routeId(
          url.pathname,
          "/host-delete",
          "conversations",
        );
        if (hostDeletionId !== null) {
          const input = parseBody(conversationHostDeletionSchema, body);
          const runtime = requireConversationRuntime(options.conversationRuntime);
          return jsonResponse(
            200,
            await runtime.hostDeletion.deleteHostConversation(
              {
                conversationId: hostDeletionId,
                personaId,
                confirmation: input.confirmation,
                acknowledgeLocalDataRemains: input.acknowledgeLocalDataRemains,
                acknowledgeBackupsMayRemain: input.acknowledgeBackupsMayRemain,
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        const journalPurgeId = routeId(
          url.pathname,
          "/journal-purge",
          "conversations",
        );
        if (journalPurgeId !== null) {
          const input = parseBody(conversationJournalPurgeSchema, body);
          return jsonResponse(
            200,
            options.conversationPrivacy.purge(
              {
                conversationId: journalPurgeId,
                personaId,
                reason: input.reason,
                confirmation: input.confirmation,
                acknowledgePermanentActiveDatabaseDeletion:
                  input.acknowledgePermanentActiveDatabaseDeletion,
                acknowledgeExternalCopiesMayRemain:
                  input.acknowledgeExternalCopiesMayRemain,
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        if (url.pathname === "/api/behavior") {
          const input = parseBody(personaBehaviorSchema, body);
          return jsonResponse(
            200,
            options.behaviors.configureProfile(
              {
                personaId,
                expectedRevisionNumber: input.expectedRevisionNumber,
                instructions: input.instructions,
                enabled: input.enabled,
                ...(input.note === undefined ? {} : { note: input.note }),
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        if (url.pathname === "/api/memories") {
          const input = parseBody(createMemorySchema, body);
          return jsonResponse(
            201,
            options.control.createMemory(
              {
                personaId,
                assertion: input.assertion,
                memoryClass: input.memoryClass,
                type: input.type,
                sensitivity: input.sensitivity,
                retrievalPolicy: input.retrievalPolicy,
                explicitness: "explicit",
                confidence: 1,
                isPinned: input.isPinned,
                isProtected: input.isProtected,
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }
        const reviewId = routeId(url.pathname, "/resolve");
        if (reviewId !== null && url.pathname.startsWith("/api/candidates/")) {
          const input = parseBody(reviewSchema, body);
          return jsonResponse(
            200,
            options.control.resolveCandidate(
              {
                personaId,
                candidateId: reviewId,
                resolution:
                  "targetMemoryId" in input
                    ? {
                        outcome: input.outcome,
                        targetMemoryId: input.targetMemoryId,
                      }
                    : { outcome: input.outcome },
              },
              {
                actor: "user",
                explicitUserAction: true,
                ...(input.note === undefined ? {} : { note: input.note }),
              },
            ),
          );
        }
        const correctionId = routeId(url.pathname, "/correct");
        if (correctionId !== null && url.pathname.startsWith("/api/memories/")) {
          const input = parseBody(correctionSchema, body);
          return jsonResponse(
            200,
            options.control.reviseMemory(
              {
                personaId,
                memoryId: correctionId,
                revision: {
                  assertion: input.assertion,
                  normalizedAssertion: null,
                  changeKind: "corrected",
                },
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }

        const deletionId = routeId(url.pathname, "/delete");
        if (deletionId !== null && url.pathname.startsWith("/api/memories/")) {
          const input = parseBody(deletionSchema, body);
          requireExactConfirmation(input.confirmation, deletionId);
          return jsonResponse(
            200,
            options.control.deleteMemory(
              {
                personaId,
                memoryId: deletionId,
                deletion: { reason: input.reason },
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }

        const restoreDeletedId = routeId(url.pathname, "/restore-deleted");
        if (
          restoreDeletedId !== null &&
          url.pathname.startsWith("/api/memories/")
        ) {
          const input = parseBody(restorationSchema, body);
          requireExactConfirmation(input.confirmation, restoreDeletedId);
          return jsonResponse(
            200,
            options.control.restoreDeletedMemory(personaId, restoreDeletedId, {
              actor: "user",
              explicitUserAction: true,
            }),
          );
        }

        const purgeId = routeId(url.pathname, "/purge");
        if (purgeId !== null && url.pathname.startsWith("/api/memories/")) {
          const input = parseBody(purgeSchema, body);
          requireExactConfirmation(input.confirmation, purgeId);
          const preview = options.control.previewMemoryPurge(personaId, purgeId);
          if (!preview.canPurge) {
            throw new HttpError(
              409,
              "The memory must be recoverably deleted before permanent purge.",
            );
          }
          return jsonResponse(
            200,
            options.control.purgeMemory(
              {
                personaId,
                memoryId: purgeId,
                purge: {
                  reason: input.reason,
                  confirmation: input.confirmation,
                },
              },
              { actor: "user", explicitUserAction: true },
            ),
          );
        }

        for (const action of ["pin", "protect"] as const) {
          const id = routeId(url.pathname, `/${action}`);
          if (id !== null && url.pathname.startsWith("/api/memories/")) {
            const input = parseBody(booleanValueSchema, body);
            const result =
              action === "pin"
                ? options.control.setPinned(personaId, id, input.value, {
                    actor: "user",
                    explicitUserAction: true,
                  })
                : options.control.setProtected(personaId, id, input.value, {
                    actor: "user",
                    explicitUserAction: true,
                  });
            return jsonResponse(200, result);
          }
        }

        for (const action of ["archive", "restore"] as const) {
          const id = routeId(url.pathname, `/${action}`);
          if (id !== null && url.pathname.startsWith("/api/memories/")) {
            parseBody(emptySchema, body);
            const result =
              action === "archive"
                ? options.control.archiveMemory(personaId, id, {
                    actor: "user",
                    explicitUserAction: true,
                  })
                : options.control.restoreMemory(personaId, id, {
                    actor: "user",
                    explicitUserAction: true,
                  });
            return jsonResponse(200, result);
          }
        }
        throw new HttpError(404, "Not found.");
      } catch (error) {
        return jsonResponse(statusForError(error), { error: errorMessage(error) });
      }
    },
  };
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(", ") : value,
    ]),
  );
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBodyBytes) {
      throw new HttpError(413, "The request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeResponse(
  response: ServerResponse,
  output: ContinuityConsoleResponse,
): void {
  response.writeHead(output.status, output.headers);
  response.end(output.body);
}

export async function startContinuityConsole(
  options: StartContinuityConsoleOptions,
): Promise<ContinuityConsoleHandle> {
  const token = requireValidToken(options.token);
  const port = requireValidPort(options.port);
  const application = createContinuityConsoleApplication(options, token);
  let origin = "";

  const server = createServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readRequestBody(request) : undefined;
      const output = await application.handle(
        {
          method: request.method ?? "GET",
          url: request.url ?? "/",
          headers: flattenHeaders(request.headers),
          ...(body === undefined ? {} : { body }),
        },
        origin,
      );
      writeResponse(response, output);
    } catch (error) {
      writeResponse(
        response,
        jsonResponse(statusForError(error), { error: errorMessage(error) }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, loopbackHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  origin = `http://${loopbackHost}:${address.port}`;
  return {
    origin,
    launchUrl: `${origin}/#token=${encodeURIComponent(token)}`,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
