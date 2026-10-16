export interface ContinuityConsoleResources {
  closeConsole(): Promise<void>;
  closeDatabase(): void;
  closeConversationRuntime?: () => Promise<void>;
}

/** Closes resources in dependency order while still attempting every close. */
export async function closeContinuityConsoleResources(
  resources: ContinuityConsoleResources,
): Promise<void> {
  let firstError: unknown;
  const attempt = async (operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      firstError ??= error;
    }
  };

  await attempt(resources.closeConsole);
  if (resources.closeConversationRuntime !== undefined) {
    await attempt(resources.closeConversationRuntime);
  }
  await attempt(resources.closeDatabase);

  if (firstError !== undefined) {
    throw firstError;
  }
}
