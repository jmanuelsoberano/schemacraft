import { isTauri } from "@tauri-apps/api/core";

/**
 * Whether the page runs inside the SchemaCraft desktop window, as opposed to a browser preview.
 * The rest of the frontend asks here instead of importing the Tauri API.
 */
export function isDesktopRuntime(): boolean {
  return isTauri();
}
