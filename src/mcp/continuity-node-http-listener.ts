import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { Buffer } from "node:buffer";
import type { ContinuityMcpHttpApplication } from "./continuity-http.js";

const loopbackHost = "127.0.0.1";
const defaultMaximumRequestBytes = 1_048_576;

export interface ContinuityNodeHttpListenerOptions {
  application: Pick<ContinuityMcpHttpApplication, "fetch">;
  publicOrigin: URL;
  port?: number;
  maximumRequestBytes?: number;
  onerror?: (error: Error) => void;
}

export interface ContinuityNodeHttpListener {
  host: typeof loopbackHost;
  port: number;
  localOrigin: string;
  close(): Promise<void>;
}

function validatePublicOrigin(publicOrigin: URL): URL {
  const normalized = new URL(publicOrigin.href);
  if (
    normalized.protocol !== "https:" ||
    normalized.username !== "" ||
    normalized.password !== "" ||
    normalized.pathname !== "/" ||
    normalized.search !== "" ||
    normalized.hash !== ""
  ) {
    throw new Error("The Continuity public origin must be an HTTPS origin URL.");
  }
  return normalized;
}

function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("The Continuity HTTP port must be an integer from 0 through 65535.");
  }
  return port;
}

function validateMaximumRequestBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16_777_216) {
    throw new Error(
      "The Continuity maximum request size must be from 1 through 16777216 bytes.",
    );
  }
  return value;
}

function requestHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (
      name === "host" ||
      name === "forwarded" ||
      name.startsWith("x-forwarded-")
    ) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
    } else {
      result.set(name, value);
    }
  }
  return result;
}

async function readRequestBody(
  request: IncomingMessage,
  maximumRequestBytes: number,
): Promise<Uint8Array | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumRequestBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

class RequestBodyTooLargeError extends Error {
  public constructor() {
    super("The Continuity HTTP request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function externalRequestUrl(request: IncomingMessage, publicOrigin: URL): URL {
  const requestTarget = request.url;
  if (requestTarget === undefined || !requestTarget.startsWith("/")) {
    throw new Error("The Continuity HTTP request target is invalid.");
  }
  const url = new URL(requestTarget, publicOrigin);
  if (url.origin !== publicOrigin.origin) {
    throw new Error("The Continuity HTTP request target crossed the public origin.");
  }
  return url;
}

async function writeResponse(
  outgoing: Response,
  response: ServerResponse,
): Promise<void> {
  response.statusCode = outgoing.status;
  response.statusMessage = outgoing.statusText;
  outgoing.headers.forEach((value, name) => response.setHeader(name, value));
  if (outgoing.body === null) {
    response.end();
    return;
  }
  response.end(Buffer.from(await outgoing.arrayBuffer()));
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    application: Pick<ContinuityMcpHttpApplication, "fetch">;
    maximumRequestBytes: number;
    publicOrigin: URL;
  },
): Promise<void> {
  try {
    const body = await readRequestBody(request, options.maximumRequestBytes);
    const externalRequest = new Request(
      externalRequestUrl(request, options.publicOrigin),
      {
        method: request.method ?? "GET",
        headers: requestHeaders(request.headers),
        ...(body === undefined ? {} : { body }),
      },
    );
    await writeResponse(
      await options.application.fetch(externalRequest),
      response,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      response.statusCode = 413;
      response.end("Request body too large.");
      return;
    }
    throw error;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function startContinuityNodeHttpListener(
  options: ContinuityNodeHttpListenerOptions,
): Promise<ContinuityNodeHttpListener> {
  const publicOrigin = validatePublicOrigin(options.publicOrigin);
  const port = validatePort(options.port ?? 0);
  const maximumRequestBytes = validateMaximumRequestBytes(
    options.maximumRequestBytes ?? defaultMaximumRequestBytes,
  );
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      application: options.application,
      maximumRequestBytes,
      publicOrigin,
    }).catch((cause: unknown) => {
      const error =
        cause instanceof Error ? cause : new Error("Unknown HTTP listener error.");
      options.onerror?.(error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
      }
      response.end("Internal server error.");
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, loopbackHost, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("The Continuity HTTP listener did not return a TCP address.");
  }
  return {
    host: loopbackHost,
    port: address.port,
    localOrigin: `http://${loopbackHost}:${address.port}`,
    close: () => closeServer(server),
  };
}
