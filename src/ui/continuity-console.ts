import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import type { PersonaContext } from "../domain/persona.js";
import type { ContinuityControlService } from "../services/continuity-control-service.js";
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

const noteSchema = z
  .object({ note: z.string().max(10_000).optional() })
  .strict();

const booleanValueSchema = z.object({ value: z.boolean() }).strict();
const emptySchema = z.object({}).strict();
const correctionSchema = z
  .object({ assertion: z.string().trim().min(1).max(50_000) })
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
  control: ContinuityControlService;
  personaContext: PersonaContext;
  port?: number;
  token?: string;
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

function jsonResponse(status: number, value: unknown): ContinuityConsoleResponse {
  return textResponse(
    status,
    "application/json; charset=utf-8",
    `${JSON.stringify(value)}\n`,
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

function routeId(pathname: string, suffix = ""): string | null {
  const expression = new RegExp(`^/api/(?:candidates|memories)/([^/]+)${suffix}$`, "u");
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

export function createContinuityConsoleApplication(
  options: Pick<StartContinuityConsoleOptions, "control" | "personaContext">,
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
          });
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

        if (request.method !== "POST") {
          throw new HttpError(405, "Method not allowed.");
        }
        requireMutationOrigin(headers, origin);
        const body = readJson(request, headers);
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
        const rejectId = routeId(url.pathname, "/reject");
        if (rejectId !== null && url.pathname.startsWith("/api/candidates/")) {
          const input = parseBody(noteSchema, body);
          return jsonResponse(
            200,
            options.control.rejectCandidate(personaId, rejectId, {
              actor: "user",
              explicitUserAction: true,
              ...(input.note === undefined ? {} : { note: input.note }),
            }),
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
