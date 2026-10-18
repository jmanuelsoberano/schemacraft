import type { AppInfo } from "@/shared/contracts";

import { invokeCommand } from "./invokeCommand";

/** Name, version and build flavour of the running application, as reported by the Rust side. */
export function getAppInfo(): Promise<AppInfo> {
  return invokeCommand<AppInfo>("get_app_info");
}

/**
 * Opens the folder of the diagnostic log in the file manager. The Rust side knows the folder,
 * so no path crosses the IPC (ADR-041).
 */
export function openLogFolder(): Promise<void> {
  return invokeCommand("open_log_folder");
}
