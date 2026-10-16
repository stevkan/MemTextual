import {
  applyWindowsHostInstallation,
  applyWindowsHostRemoval,
  previewWindowsHostInstallation,
  previewWindowsHostRemoval,
  type WindowsHostIntegrationConfiguration,
  type WindowsHostInstallationResult,
  type WindowsHostOperations,
  type WindowsHostRemovalResult,
} from "../platform/windows-host-integration.js";

export const windowsMsiHostActions = [
  "install",
  "rollback-install",
  "uninstall",
  "rollback-uninstall",
] as const;
export type WindowsMsiHostAction = (typeof windowsMsiHostActions)[number];

export async function executeWindowsMsiHostAction(options: {
  action: WindowsMsiHostAction;
  configuration: WindowsHostIntegrationConfiguration;
  operations: WindowsHostOperations;
}): Promise<WindowsHostInstallationResult | WindowsHostRemovalResult> {
  const context = { actorId: "windows-installer", explicitUserAction: true as const };
  if (options.action === "install" || options.action === "rollback-uninstall") {
    const preview = await previewWindowsHostInstallation(options.operations, options.configuration);
    return applyWindowsHostInstallation(options.operations, options.configuration, preview.confirmation, context);
  }
  const preview = await previewWindowsHostRemoval(options.operations, options.configuration);
  return applyWindowsHostRemoval(options.operations, options.configuration, preview.confirmation, context);
}
