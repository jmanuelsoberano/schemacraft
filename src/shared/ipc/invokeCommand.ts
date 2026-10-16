import { invoke } from "@tauri-apps/api/core";

import { toOperationError } from "./operationError";

/**
 * Invokes a Tauri command and turns any failure into an {@link OperationError}, so every backend
 * reports errors the same way. Feature code never calls `invoke` directly.
 */
export async function invokeCommand<T>(
  command: string,
  arguments_: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(command, arguments_);
  } catch (error: unknown) {
    throw toOperationError(error);
  }
}
