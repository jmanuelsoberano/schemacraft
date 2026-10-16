import type { AppInfo } from "@/shared/contracts";

import { invokeCommand } from "./invokeCommand";

/** Name, version and build flavour of the running application, as reported by the Rust side. */
export function getAppInfo(): Promise<AppInfo> {
  return invokeCommand<AppInfo>("get_app_info");
}
