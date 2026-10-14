import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ClientCertificateCredential } from "@azure/identity";
import type {
  HostAdapterIdentity,
  HostCredentialProvider,
  HostCredentialReference,
} from "../platform/host-platform.js";
import { detectHostPlatform } from "../platform/host-platform.js";

export const azureCertificateCredentialConfigFormatVersion = 1 as const;

export interface AzureCertificateCredentialConfiguration {
  certificatePath: string;
  clientId: string;
  credentialId: string;
  formatVersion: typeof azureCertificateCredentialConfigFormatVersion;
  tenantId: string;
}

export type AzureCertificateCredentialHealth =
  | "valid"
  | "expiring"
  | "expired"
  | "not_yet_valid";

export interface AzureCertificateCredentialStatus {
  certificateExpiresAt: string;
  certificateFingerprint256: string;
  certificateValidFrom: string;
  credentialId: string;
  health: AzureCertificateCredentialHealth;
}

export interface AzureCertificateCredentialProviderOptions {
  configuration: AzureCertificateCredentialConfiguration;
  expirationWarningDays?: number;
  now?: () => Date;
}

const configurationKeys = new Set([
  "certificatePath",
  "clientId",
  "credentialId",
  "formatVersion",
  "tenantId",
]);

function requireGuid(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      value,
    )
  ) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function requireCredentialId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
  ) {
    throw new Error(
      "Azure certificate credentialId must use 1-128 safe identifier characters.",
    );
  }
  return value;
}

function requireDirectCertificate(path: string): string {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error("Azure certificate credential file does not exist.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Azure certificate credential file must be a direct regular file.",
    );
  }
  if (stats.size === 0 || stats.size > 1024 * 1024) {
    throw new Error("Azure certificate credential file size is invalid.");
  }
  return path;
}

export function parseAzureCertificateCredentialConfiguration(
  value: unknown,
): AzureCertificateCredentialConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Azure certificate credential configuration must be an object.");
  }
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).filter(
    (key) => !configurationKeys.has(key),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Azure certificate credential configuration contains unsupported properties: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (record.formatVersion !== azureCertificateCredentialConfigFormatVersion) {
    throw new Error(
      `Azure certificate credential formatVersion must be ${azureCertificateCredentialConfigFormatVersion}.`,
    );
  }
  if (
    typeof record.certificatePath !== "string" ||
    record.certificatePath.length === 0 ||
    record.certificatePath !== record.certificatePath.trim() ||
    !isAbsolute(record.certificatePath)
  ) {
    throw new Error("Azure certificatePath must be a non-empty absolute path.");
  }
  return {
    certificatePath: resolve(record.certificatePath),
    clientId: requireGuid(record.clientId, "Azure certificate clientId"),
    credentialId: requireCredentialId(record.credentialId),
    formatVersion: azureCertificateCredentialConfigFormatVersion,
    tenantId: requireGuid(record.tenantId, "Azure certificate tenantId"),
  };
}

export function loadAzureCertificateCredentialConfiguration(
  configurationPath: string,
): AzureCertificateCredentialConfiguration {
  const path = resolve(configurationPath);
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new Error("Azure certificate credential configuration does not exist.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Azure certificate credential configuration must be a direct regular file.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Azure certificate credential configuration is not valid JSON.",
    );
  }
  return parseAzureCertificateCredentialConfiguration(value);
}

function certificateStatus(
  configuration: AzureCertificateCredentialConfiguration,
  now: Date,
  expirationWarningDays: number,
): AzureCertificateCredentialStatus {
  const certificatePath = requireDirectCertificate(configuration.certificatePath);
  const pem = readFileSync(certificatePath, "utf8");
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/u.test(pem)) {
    throw new Error(
      "Encrypted PEM private keys are not supported by the unattended credential provider.",
    );
  }
  if (
    !/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/u.test(pem) ||
    !/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u.test(pem)
  ) {
    throw new Error(
      "Azure certificate credential file must contain a PEM certificate and private key.",
    );
  }
  const certificateBlock = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/u,
  )?.[0];
  if (certificateBlock === undefined) {
    throw new Error("Azure certificate credential PEM certificate is missing.");
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(certificateBlock);
  } catch {
    throw new Error("Azure certificate credential contains an invalid certificate.");
  }
  const validFrom = new Date(certificate.validFrom);
  const expiresAt = new Date(certificate.validTo);
  if (
    Number.isNaN(validFrom.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= validFrom
  ) {
    throw new Error("Azure certificate credential validity period is invalid.");
  }
  let health: AzureCertificateCredentialHealth;
  if (now < validFrom) {
    health = "not_yet_valid";
  } else if (now >= expiresAt) {
    health = "expired";
  } else if (
    expiresAt.getTime() - now.getTime() <=
    expirationWarningDays * 24 * 60 * 60 * 1_000
  ) {
    health = "expiring";
  } else {
    health = "valid";
  }
  return {
    certificateExpiresAt: expiresAt.toISOString(),
    certificateFingerprint256: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
    certificateValidFrom: validFrom.toISOString(),
    credentialId: configuration.credentialId,
    health,
  };
}

export class AzureCertificateCredentialProvider
  implements HostCredentialProvider<ClientCertificateCredential>
{
  readonly identity: HostAdapterIdentity;
  readonly #configuration: AzureCertificateCredentialConfiguration;
  readonly #expirationWarningDays: number;
  readonly #now: () => Date;

  constructor(options: AzureCertificateCredentialProviderOptions) {
    this.#configuration = parseAzureCertificateCredentialConfiguration(
      options.configuration,
    );
    const expirationWarningDays = options.expirationWarningDays ?? 30;
    if (
      !Number.isSafeInteger(expirationWarningDays) ||
      expirationWarningDays < 1 ||
      expirationWarningDays > 365
    ) {
      throw new Error(
        "Azure certificate expirationWarningDays must be an integer from 1 through 365.",
      );
    }
    this.#expirationWarningDays = expirationWarningDays;
    this.#now = options.now ?? (() => new Date());
    const platform = detectHostPlatform();
    if (platform === "unsupported") {
      throw new Error("Azure certificate credentials are unsupported on this host.");
    }
    this.identity = {
      adapterId: "azure-client-certificate",
      adapterVersion: "1",
      platform,
    };
  }

  inspect(reference: HostCredentialReference): AzureCertificateCredentialStatus {
    this.#requireReference(reference);
    const now = this.#now();
    if (Number.isNaN(now.getTime())) {
      throw new Error("Azure certificate credential current time is invalid.");
    }
    return certificateStatus(
      this.#configuration,
      now,
      this.#expirationWarningDays,
    );
  }

  async acquire(
    reference: HostCredentialReference,
  ): Promise<ClientCertificateCredential> {
    const status = this.inspect(reference);
    if (status.health === "expired" || status.health === "not_yet_valid") {
      throw new Error(
        `Azure certificate credential is not currently usable: ${status.health}.`,
      );
    }
    return new ClientCertificateCredential(
      this.#configuration.tenantId,
      this.#configuration.clientId,
      this.#configuration.certificatePath,
    );
  }

  #requireReference(reference: HostCredentialReference): void {
    if (
      reference.kind !== "certificate" ||
      reference.credentialId !== this.#configuration.credentialId
    ) {
      throw new Error("Azure certificate credential reference does not match.");
    }
  }
}
