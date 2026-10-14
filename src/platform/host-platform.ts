export const hostPlatforms = ["windows", "macos", "linux"] as const;

export type HostPlatform = (typeof hostPlatforms)[number];

export type HostPlatformDetection = HostPlatform | "unsupported";

export function detectHostPlatform(
  platform: NodeJS.Platform = process.platform,
): HostPlatformDetection {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return "unsupported";
  }
}

export interface HostAdapterIdentity {
  adapterId: string;
  adapterVersion: string;
  platform: HostPlatform;
}

export interface ExplicitHostMutationContext {
  actorId: string;
  explicitUserAction: true;
}

export interface HostScheduledCommand {
  executablePath: string;
  arguments: readonly string[];
  workingDirectory: string;
  /** Names only. Secret values must not be embedded in a schedule definition. */
  environmentVariableNames: readonly string[];
}

export interface HostScheduleDefinition {
  scheduleId: string;
  intervalMinutes: number;
  command: HostScheduledCommand;
}

export interface HostScheduleState {
  scheduleId: string;
  installed: boolean;
  enabled: boolean;
  definition?: HostScheduleDefinition;
}

export interface HostSchedulerAdapter {
  readonly identity: HostAdapterIdentity;
  inspect(scheduleId: string): Promise<HostScheduleState>;
  install(
    definition: HostScheduleDefinition,
    context: ExplicitHostMutationContext,
  ): Promise<HostScheduleState>;
  remove(
    scheduleId: string,
    context: ExplicitHostMutationContext,
  ): Promise<HostScheduleState>;
}

export type HostCredentialKind =
  | "certificate"
  | "delegated-token-cache"
  | "managed-identity"
  | "external";

export interface HostCredentialReference {
  credentialId: string;
  kind: HostCredentialKind;
}

/**
 * Acquires an in-memory SDK credential from a non-secret reference. The
 * returned credential must never be serialized into MemTextual configuration.
 */
export interface HostCredentialProvider<TCredential> {
  readonly identity: HostAdapterIdentity;
  acquire(reference: HostCredentialReference): Promise<TCredential>;
}

export interface HostServiceIdentityRequest {
  identityName: string;
  purpose: string;
}

export interface HostServiceIdentityState {
  identityName: string;
  available: boolean;
  managedByMemTextual: boolean;
}

export interface HostServiceIdentityAdapter {
  readonly identity: HostAdapterIdentity;
  inspect(identityName: string): Promise<HostServiceIdentityState>;
  provision(
    request: HostServiceIdentityRequest,
    context: ExplicitHostMutationContext,
  ): Promise<HostServiceIdentityState>;
  remove(
    identityName: string,
    context: ExplicitHostMutationContext,
  ): Promise<HostServiceIdentityState>;
}

export interface HostIntegrationBundle<TCredential = unknown> {
  platform: HostPlatform;
  scheduler?: HostSchedulerAdapter;
  credentialProvider?: HostCredentialProvider<TCredential>;
  serviceIdentity?: HostServiceIdentityAdapter;
}
