import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as z from "zod/v4";

export const continuityRemoteConfigurationFormatVersion = 1 as const;

const httpsOriginSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "must be a valid URL" });
      return z.NEVER;
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.href !== value
    ) {
      context.addIssue({
        code: "custom",
        message: "must be an exact HTTPS origin ending with a slash",
      });
      return z.NEVER;
    }
    return url.href;
  });

const clientIdSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => value === value.trim(), "must be trimmed")
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "must not contain control characters",
  );

const writeAuthorizationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("deny") }).strict(),
  z
    .object({
      mode: z.literal("trusted_oauth_client"),
      trustedClientIds: z.array(clientIdSchema).min(1).max(8),
    })
    .strict()
    .refine(
      ({ trustedClientIds }) =>
        new Set(trustedClientIds).size === trustedClientIds.length,
      { message: "trustedClientIds must be unique" },
    ),
]);

const remoteConfigurationSchema = z
  .object({
    formatVersion: z.literal(continuityRemoteConfigurationFormatVersion),
    auth0Issuer: httpsOriginSchema,
    publicOrigin: httpsOriginSchema,
    port: z.number().int().min(1).max(65_535),
    writeAuthorization: writeAuthorizationSchema,
  })
  .strict();

export type ContinuityRemoteWriteAuthorization = z.infer<
  typeof writeAuthorizationSchema
>;

export interface ContinuityRemoteConfiguration {
  formatVersion: typeof continuityRemoteConfigurationFormatVersion;
  auth0Issuer: string;
  publicOrigin: string;
  port: number;
  writeAuthorization: ContinuityRemoteWriteAuthorization;
}

export function parseContinuityRemoteConfiguration(
  value: unknown,
): ContinuityRemoteConfiguration {
  const result = remoteConfigurationSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Continuity remote configuration is invalid: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

export function loadContinuityRemoteConfiguration(
  configurationPath: string,
): ContinuityRemoteConfiguration {
  const path = resolve(configurationPath);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error(`Continuity remote configuration does not exist: ${path}.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Continuity remote configuration must be a direct regular file.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error("Continuity remote configuration is not valid JSON.");
  }
  return parseContinuityRemoteConfiguration(decoded);
}

export function continuityRemoteResourceServerUrl(
  configuration: ContinuityRemoteConfiguration,
): URL {
  return new URL("mcp", configuration.publicOrigin);
}
