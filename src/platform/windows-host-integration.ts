import { createHash } from "node:crypto";
import { win32 } from "node:path";
import type {
  ExplicitHostMutationContext,
  HostIntegrationBundle,
  HostScheduleDefinition,
  HostScheduledCommand,
  HostSchedulerAdapter,
  HostScheduleState,
  HostServiceIdentityAdapter,
  HostServiceIdentityRequest,
  HostServiceIdentityState,
} from "./host-platform.js";

export const windowsHostIntegrationPlanFormatVersion = 1 as const;

export interface WindowsManagedScheduleState extends HostScheduleState {
  managedByMemTextual: boolean;
}

export interface WindowsHostOperations {
  inspectIdentity(identityName: string): Promise<HostServiceIdentityState>;
  inspectSchedule(scheduleId: string): Promise<WindowsManagedScheduleState>;
  installSchedule(
    definition: HostScheduleDefinition,
    identityName: string,
  ): Promise<WindowsManagedScheduleState>;
  protectPaths(paths: readonly string[], identityName: string): Promise<void>;
  provisionIdentity(
    request: HostServiceIdentityRequest,
  ): Promise<HostServiceIdentityState>;
  removeIdentity(identityName: string): Promise<HostServiceIdentityState>;
  removeSchedule(scheduleId: string): Promise<WindowsManagedScheduleState>;
}

export interface WindowsHostIntegrationConfiguration {
  formatVersion: typeof windowsHostIntegrationPlanFormatVersion;
  identity: HostServiceIdentityRequest;
  protectedPaths: readonly string[];
  schedules: readonly HostScheduleDefinition[];
}

export interface WindowsHostInstallationPreview {
  confirmation: string;
  currentIdentity: HostServiceIdentityState;
  currentSchedules: readonly WindowsManagedScheduleState[];
  formatVersion: typeof windowsHostIntegrationPlanFormatVersion;
  identityWillBeProvisioned: boolean;
  operation: "install";
  pathsWillBeProtected: readonly string[];
  schedulesWillBeInstalled: readonly string[];
}

export interface WindowsHostRemovalPreview {
  confirmation: string;
  currentIdentity: HostServiceIdentityState;
  currentSchedules: readonly WindowsManagedScheduleState[];
  dataPathsPreserved: readonly string[];
  formatVersion: typeof windowsHostIntegrationPlanFormatVersion;
  identityWillBeRemoved: boolean;
  operation: "remove";
  schedulesWillBeRemoved: readonly string[];
}

export interface WindowsHostInstallationResult {
  identity: HostServiceIdentityState;
  installedSchedules: readonly WindowsManagedScheduleState[];
  operation: "install";
  protectedPaths: readonly string[];
}

export interface WindowsHostRemovalResult {
  identity: HostServiceIdentityState;
  operation: "remove";
  preservedDataPaths: readonly string[];
  removedSchedules: readonly WindowsManagedScheduleState[];
}

function requireMutationContext(context: ExplicitHostMutationContext): void {
  if (
    context.explicitUserAction !== true ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(context.actorId)
  ) {
    throw new Error(
      "Windows host mutation requires an explicit user action and safe actor identifier.",
    );
  }
}

function requireIdentityName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/u.test(value)) {
    throw new Error(
      "Windows service identity name must use 1-20 safe local-account characters.",
    );
  }
  return value;
}

function validateIdentityRequest(
  request: HostServiceIdentityRequest,
): HostServiceIdentityRequest {
  const purpose = request.purpose.trim();
  if (purpose.length === 0 || purpose.length > 256) {
    throw new Error("Windows service identity purpose is invalid.");
  }
  return {
    identityName: requireIdentityName(request.identityName),
    purpose,
  };
}

function requireScheduleId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error("Windows schedule identifier is invalid.");
  }
  return value;
}

function validateCommand(command: HostScheduledCommand): HostScheduledCommand {
  if (
    !win32.isAbsolute(command.executablePath) ||
    !win32.isAbsolute(command.workingDirectory)
  ) {
    throw new Error(
      "Windows scheduled executable and working directory must be absolute paths.",
    );
  }
  if (
    command.arguments.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.includes("\0") ||
        /(?:password|secret|token|key)=/iu.test(argument),
    )
  ) {
    throw new Error(
      "Windows scheduled arguments are invalid or appear to contain secret material.",
    );
  }
  const environmentVariableNames = [...command.environmentVariableNames];
  if (
    new Set(environmentVariableNames).size !== environmentVariableNames.length ||
    environmentVariableNames.some(
      (name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name),
    )
  ) {
    throw new Error(
      "Windows scheduled environment entries must be unique variable names only.",
    );
  }
  return {
    arguments: [...command.arguments],
    environmentVariableNames,
    executablePath: win32.resolve(command.executablePath),
    workingDirectory: win32.resolve(command.workingDirectory),
  };
}

function validateSchedule(
  definition: HostScheduleDefinition,
): HostScheduleDefinition {
  if (
    !Number.isSafeInteger(definition.intervalMinutes) ||
    definition.intervalMinutes < 5 ||
    definition.intervalMinutes > 525_600
  ) {
    throw new Error(
      "Windows schedule intervalMinutes must be an integer from 5 through 525600.",
    );
  }
  return {
    command: validateCommand(definition.command),
    intervalMinutes: definition.intervalMinutes,
    scheduleId: requireScheduleId(definition.scheduleId),
  };
}

function validateConfiguration(
  configuration: WindowsHostIntegrationConfiguration,
): WindowsHostIntegrationConfiguration {
  if (configuration.formatVersion !== windowsHostIntegrationPlanFormatVersion) {
    throw new Error(
      `Windows host configuration formatVersion must be ${windowsHostIntegrationPlanFormatVersion}.`,
    );
  }
  const identity = validateIdentityRequest(configuration.identity);
  const protectedPaths = configuration.protectedPaths.map((path) => {
    if (!win32.isAbsolute(path)) {
      throw new Error("Windows protected paths must be absolute.");
    }
    return win32.resolve(path);
  });
  if (
    protectedPaths.length === 0 ||
    new Set(protectedPaths.map((path) => path.toLowerCase())).size !==
      protectedPaths.length
  ) {
    throw new Error("Windows protected paths must be non-empty and unique.");
  }
  const schedules = configuration.schedules.map(validateSchedule);
  if (
    schedules.length === 0 ||
    new Set(schedules.map(({ scheduleId }) => scheduleId.toLowerCase())).size !==
      schedules.length
  ) {
    throw new Error("Windows schedules must be non-empty and uniquely named.");
  }
  return {
    formatVersion: windowsHostIntegrationPlanFormatVersion,
    identity,
    protectedPaths,
    schedules,
  };
}

function sameDefinition(
  left: HostScheduleDefinition | undefined,
  right: HostScheduleDefinition,
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function confirmation(prefix: "INSTALL" | "REMOVE", value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (typeof input !== "object" || input === null) return input;
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex")
    .slice(0, 20)
    .toUpperCase();
  return `${prefix}-WINDOWS-HOST-${digest}`;
}

export class WindowsTaskSchedulerAdapter implements HostSchedulerAdapter {
  readonly identity = {
    adapterId: "windows-task-scheduler",
    adapterVersion: "1",
    platform: "windows",
  } as const;

  constructor(
    private readonly operations: WindowsHostOperations,
    private readonly serviceIdentityName: string,
  ) {
    requireIdentityName(serviceIdentityName);
  }

  inspect(scheduleId: string): Promise<WindowsManagedScheduleState> {
    return this.operations.inspectSchedule(requireScheduleId(scheduleId));
  }

  async install(
    definition: HostScheduleDefinition,
    context: ExplicitHostMutationContext,
  ): Promise<WindowsManagedScheduleState> {
    requireMutationContext(context);
    const validated = validateSchedule(definition);
    const current = await this.inspect(validated.scheduleId);
    if (
      current.installed &&
      (!current.managedByMemTextual ||
        !sameDefinition(current.definition, validated))
    ) {
      throw new Error(
        `Windows schedule already exists but is not the managed MemTextual definition: ${validated.scheduleId}.`,
      );
    }
    return current.installed
      ? current
      : this.operations.installSchedule(validated, this.serviceIdentityName);
  }

  async remove(
    scheduleId: string,
    context: ExplicitHostMutationContext,
  ): Promise<WindowsManagedScheduleState> {
    requireMutationContext(context);
    const current = await this.inspect(scheduleId);
    return current.installed
      ? this.operations.removeSchedule(current.scheduleId)
      : current;
  }
}

export class WindowsServiceIdentityAdapter
  implements HostServiceIdentityAdapter
{
  readonly identity = {
    adapterId: "windows-local-service-identity",
    adapterVersion: "1",
    platform: "windows",
  } as const;

  constructor(private readonly operations: WindowsHostOperations) {}

  inspect(identityName: string): Promise<HostServiceIdentityState> {
    return this.operations.inspectIdentity(requireIdentityName(identityName));
  }

  async provision(
    request: HostServiceIdentityRequest,
    context: ExplicitHostMutationContext,
  ): Promise<HostServiceIdentityState> {
    requireMutationContext(context);
    const validated = validateIdentityRequest(request);
    const current = await this.inspect(validated.identityName);
    if (current.available && !current.managedByMemTextual) {
      throw new Error(
        `Windows identity exists but is not managed by MemTextual: ${validated.identityName}.`,
      );
    }
    return current.available
      ? current
      : this.operations.provisionIdentity(validated);
  }

  async remove(
    identityName: string,
    context: ExplicitHostMutationContext,
  ): Promise<HostServiceIdentityState> {
    requireMutationContext(context);
    const current = await this.inspect(identityName);
    if (!current.available) return current;
    if (!current.managedByMemTextual) {
      throw new Error(
        `Windows identity is not managed by MemTextual: ${current.identityName}.`,
      );
    }
    return this.operations.removeIdentity(current.identityName);
  }
}

export function createWindowsHostIntegrationBundle(
  operations: WindowsHostOperations,
  serviceIdentityName: string,
): HostIntegrationBundle {
  return {
    platform: "windows",
    scheduler: new WindowsTaskSchedulerAdapter(
      operations,
      serviceIdentityName,
    ),
    serviceIdentity: new WindowsServiceIdentityAdapter(operations),
  };
}

export async function previewWindowsHostInstallation(
  operations: WindowsHostOperations,
  configuration: WindowsHostIntegrationConfiguration,
): Promise<WindowsHostInstallationPreview> {
  const validated = validateConfiguration(configuration);
  const currentIdentity = await operations.inspectIdentity(
    validated.identity.identityName,
  );
  if (currentIdentity.available && !currentIdentity.managedByMemTextual) {
    throw new Error(
      `Windows identity exists but is not managed by MemTextual: ${currentIdentity.identityName}.`,
    );
  }
  const currentSchedules = await Promise.all(
    validated.schedules.map(({ scheduleId }) =>
      operations.inspectSchedule(scheduleId),
    ),
  );
  for (const [index, current] of currentSchedules.entries()) {
    const expected = validated.schedules[index]!;
    if (
      current.installed &&
      (!current.managedByMemTextual ||
        !sameDefinition(current.definition, expected))
    ) {
      throw new Error(
        `Windows schedule exists but is not the managed MemTextual definition: ${current.scheduleId}.`,
      );
    }
  }
  const previewWithoutConfirmation = {
    currentIdentity,
    currentSchedules,
    formatVersion: windowsHostIntegrationPlanFormatVersion,
    identityWillBeProvisioned: !currentIdentity.available,
    operation: "install" as const,
    pathsWillBeProtected: validated.protectedPaths,
    schedulesWillBeInstalled: validated.schedules
      .filter((_, index) => !currentSchedules[index]!.installed)
      .map(({ scheduleId }) => scheduleId),
  };
  return {
    confirmation: confirmation("INSTALL", {
      configuration: validated,
      preview: previewWithoutConfirmation,
    }),
    ...previewWithoutConfirmation,
  };
}

export async function applyWindowsHostInstallation(
  operations: WindowsHostOperations,
  configuration: WindowsHostIntegrationConfiguration,
  confirmationToken: string,
  context: ExplicitHostMutationContext,
): Promise<WindowsHostInstallationResult> {
  requireMutationContext(context);
  const validated = validateConfiguration(configuration);
  const preview = await previewWindowsHostInstallation(operations, validated);
  if (confirmationToken !== preview.confirmation) {
    throw new Error(
      "Windows host installation confirmation is missing, incorrect, or stale.",
    );
  }
  const identityAdapter = new WindowsServiceIdentityAdapter(operations);
  const scheduler = new WindowsTaskSchedulerAdapter(
    operations,
    validated.identity.identityName,
  );
  let provisionedIdentity = false;
  const installedScheduleIds: string[] = [];
  try {
    const identity = preview.identityWillBeProvisioned
      ? await identityAdapter.provision(validated.identity, context)
      : preview.currentIdentity;
    provisionedIdentity = preview.identityWillBeProvisioned;
    await operations.protectPaths(
      validated.protectedPaths,
      validated.identity.identityName,
    );
    const installedSchedules: WindowsManagedScheduleState[] = [];
    for (const definition of validated.schedules) {
      const wasInstalled = preview.currentSchedules.find(
        ({ scheduleId }) => scheduleId === definition.scheduleId,
      )!.installed;
      const state = await scheduler.install(definition, context);
      installedSchedules.push(state);
      if (!wasInstalled) installedScheduleIds.push(definition.scheduleId);
    }
    return {
      identity,
      installedSchedules,
      operation: "install",
      protectedPaths: validated.protectedPaths,
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const scheduleId of installedScheduleIds.reverse()) {
      try {
        await operations.removeSchedule(scheduleId);
      } catch (rollbackError) {
        rollbackFailures.push(
          `${scheduleId}: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}`,
        );
      }
    }
    if (provisionedIdentity) {
      try {
        await operations.removeIdentity(validated.identity.identityName);
      } catch (rollbackError) {
        rollbackFailures.push(
          `${validated.identity.identityName}: ${rollbackError instanceof Error ? rollbackError.message : "unknown rollback failure"}`,
        );
      }
    }
    const message =
      error instanceof Error ? error.message : "Unknown Windows host failure";
    throw new Error(
      rollbackFailures.length === 0
        ? `Windows host installation failed and was rolled back: ${message}`
        : `Windows host installation failed and rollback was incomplete. Installation error: ${message}. Rollback errors: ${rollbackFailures.join("; ")}.`,
    );
  }
}

export async function previewWindowsHostRemoval(
  operations: WindowsHostOperations,
  configuration: WindowsHostIntegrationConfiguration,
): Promise<WindowsHostRemovalPreview> {
  const validated = validateConfiguration(configuration);
  const currentIdentity = await operations.inspectIdentity(
    validated.identity.identityName,
  );
  const currentSchedules = await Promise.all(
    validated.schedules.map(({ scheduleId }) =>
      operations.inspectSchedule(scheduleId),
    ),
  );
  for (const [index, current] of currentSchedules.entries()) {
    const expected = validated.schedules[index]!;
    if (
      current.installed &&
      (!current.managedByMemTextual ||
        !sameDefinition(current.definition, expected))
    ) {
      throw new Error(
        `Windows schedule is not the MemTextual definition and will not be removed: ${current.scheduleId}.`,
      );
    }
  }
  const previewWithoutConfirmation = {
    currentIdentity,
    currentSchedules,
    dataPathsPreserved: validated.protectedPaths,
    formatVersion: windowsHostIntegrationPlanFormatVersion,
    identityWillBeRemoved:
      currentIdentity.available && currentIdentity.managedByMemTextual,
    operation: "remove" as const,
    schedulesWillBeRemoved: currentSchedules
      .filter(({ installed }) => installed)
      .map(({ scheduleId }) => scheduleId),
  };
  return {
    confirmation: confirmation("REMOVE", {
      configuration: validated,
      preview: previewWithoutConfirmation,
    }),
    ...previewWithoutConfirmation,
  };
}

export async function applyWindowsHostRemoval(
  operations: WindowsHostOperations,
  configuration: WindowsHostIntegrationConfiguration,
  confirmationToken: string,
  context: ExplicitHostMutationContext,
): Promise<WindowsHostRemovalResult> {
  requireMutationContext(context);
  const validated = validateConfiguration(configuration);
  const preview = await previewWindowsHostRemoval(operations, validated);
  if (confirmationToken !== preview.confirmation) {
    throw new Error(
      "Windows host removal confirmation is missing, incorrect, or stale.",
    );
  }
  const removedSchedules: WindowsManagedScheduleState[] = [];
  for (const scheduleId of preview.schedulesWillBeRemoved) {
    removedSchedules.push(await operations.removeSchedule(scheduleId));
  }
  const identity = preview.identityWillBeRemoved
    ? await operations.removeIdentity(validated.identity.identityName)
    : preview.currentIdentity;
  return {
    identity,
    operation: "remove",
    preservedDataPaths: validated.protectedPaths,
    removedSchedules,
  };
}
