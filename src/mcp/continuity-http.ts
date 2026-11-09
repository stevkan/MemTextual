import {
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  type AuthInfo,
  type AuthMetadataOptions,
  type McpHttpHandler,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import type { ContinuityAuthenticatedPrincipal } from "../services/continuity-authenticated-persona-service.js";
import {
  continuityMcpReadScope,
  continuityMcpServerName,
  continuityMcpWriteScope,
  type ContinuityToolAuthorization,
} from "./continuity-contract.js";
import {
  createContinuityMcpServer,
  type ContinuityMcpServerDependencies,
} from "./continuity-server.js";

export interface ContinuityMcpHttpPrincipalResolver {
  resolve(
    authInfo: AuthInfo,
  ):
    | ContinuityAuthenticatedPrincipal
    | Promise<ContinuityAuthenticatedPrincipal>;
}

export interface ContinuityMcpExplicitUserActionInput {
  authInfo: AuthInfo;
  principal: ContinuityAuthenticatedPrincipal;
  request: Request;
  authorization: Exclude<
    ContinuityToolAuthorization,
    "authenticated_read"
  >;
}

export interface ContinuityMcpExplicitUserActionPolicy {
  authorize(
    input: ContinuityMcpExplicitUserActionInput,
  ): boolean | Promise<boolean>;
}

export interface ContinuityMcpHttpApplicationOptions {
  oauthMetadata: AuthMetadataOptions["oauthMetadata"];
  resourceServerUrl: URL;
  serviceDocumentationUrl?: URL;
  tokenVerifier: OAuthTokenVerifier;
  principalResolver: ContinuityMcpHttpPrincipalResolver;
  explicitUserActionPolicy: ContinuityMcpExplicitUserActionPolicy;
  services: Omit<ContinuityMcpServerDependencies, "authorization">;
  maxRequestBodySize?: number;
  onerror?: (error: Error) => void;
  dangerouslyAllowInsecureIssuerUrl?: boolean;
}

export interface ContinuityMcpHttpApplication {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function assertResourceServerUrl(resourceServerUrl: URL): void {
  if (
    resourceServerUrl.protocol !== "https:" &&
    !(
      resourceServerUrl.protocol === "http:" &&
      isLoopbackHostname(resourceServerUrl.hostname)
    )
  ) {
    throw new Error(
      "The Continuity MCP resource URL must use HTTPS, except for loopback testing.",
    );
  }
  if (resourceServerUrl.hash !== "" || resourceServerUrl.search !== "") {
    throw new Error(
      "The Continuity MCP resource URL must not contain a query string or fragment.",
    );
  }
}

function assertPrincipal(
  principal: ContinuityAuthenticatedPrincipal,
): ContinuityAuthenticatedPrincipal {
  if (
    principal.authenticationSubject.trim() === "" ||
    principal.continuityUserId.trim() === ""
  ) {
    throw new Error(
      "The Continuity principal resolver returned an incomplete principal.",
    );
  }
  return principal;
}

function isMcpEndpointRequest(request: Request, resourceServerUrl: URL): boolean {
  const requestUrl = new URL(request.url);
  return (
    requestUrl.origin === resourceServerUrl.origin &&
    requestUrl.pathname === resourceServerUrl.pathname
  );
}

export function createContinuityMcpHttpApplication(
  options: ContinuityMcpHttpApplicationOptions,
): ContinuityMcpHttpApplication {
  assertResourceServerUrl(options.resourceServerUrl);

  const metadataOptions: AuthMetadataOptions = {
    oauthMetadata: options.oauthMetadata,
    resourceServerUrl: options.resourceServerUrl,
    scopesSupported: [continuityMcpReadScope, continuityMcpWriteScope],
    resourceName: continuityMcpServerName,
    ...(options.serviceDocumentationUrl === undefined
      ? {}
      : { serviceDocumentationUrl: options.serviceDocumentationUrl }),
    ...(options.dangerouslyAllowInsecureIssuerUrl === undefined
      ? {}
      : {
          dangerouslyAllowInsecureIssuerUrl:
            options.dangerouslyAllowInsecureIssuerUrl,
        }),
  };

  // Validate discovery configuration at construction rather than on first use.
  buildOAuthProtectedResourceMetadata(metadataOptions);

  const authenticate = requireBearerAuth({
    verifier: options.tokenVerifier,
    expectedResource: options.resourceServerUrl,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      options.resourceServerUrl,
    ),
  });

  const handler: McpHttpHandler = createMcpHandler(
    async ({ authInfo, requestInfo }) => {
      if (authInfo === undefined || requestInfo === undefined) {
        throw new Error(
          "Continuity MCP HTTP requests require verified authentication context.",
        );
      }

      const principal = assertPrincipal(
        await options.principalResolver.resolve(authInfo),
      );

      return createContinuityMcpServer({
        ...options.services,
        authorization: {
          resolve: async (_context, authorization) => ({
            principal,
            scopes: [...authInfo.scopes],
            explicitUserAction:
              authorization === "authenticated_read"
                ? false
                : await options.explicitUserActionPolicy.authorize({
                    authInfo,
                    principal,
                    request: requestInfo,
                    authorization,
                  }),
          }),
        },
      });
    },
    {
      legacy: "stateless",
      responseMode: "auto",
      ...(options.maxRequestBodySize === undefined
        ? {}
        : { maxRequestBodySize: options.maxRequestBodySize }),
      ...(options.onerror === undefined ? {} : { onerror: options.onerror }),
    },
  );

  return {
    async fetch(request: Request): Promise<Response> {
      const metadataResponse = oauthMetadataResponse(request, metadataOptions);
      if (metadataResponse !== undefined) {
        return metadataResponse;
      }
      if (!isMcpEndpointRequest(request, options.resourceServerUrl)) {
        return new Response("Not found.", { status: 404 });
      }

      const authentication = await authenticate(request);
      if (authentication instanceof Response) {
        return authentication;
      }
      return handler.fetch(request, { authInfo: authentication });
    },
    close: () => handler.close(),
  };
}
