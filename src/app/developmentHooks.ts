import { useConnectionStore } from "@/features/connection/connectionStore";
import { useSchemaStore } from "@/features/schema/schemaStore";

/** Stores reachable from the window object, for automated checks against a running build. */
export interface DevelopmentHooks {
  connection: typeof useConnectionStore;
  schema: typeof useSchemaStore;
}

declare global {
  interface Window {
    __schemacraft?: DevelopmentHooks;
  }
}

/**
 * Exposes the application stores on `window.__schemacraft` in development builds, so scripts
 * attached to the webview (for example through the remote debugging port) can drive flows and
 * read state. Production builds never call this.
 */
export function installDevelopmentHooks(): void {
  if (!import.meta.env.DEV) {
    return;
  }
  window.__schemacraft = { connection: useConnectionStore, schema: useSchemaStore };
}
