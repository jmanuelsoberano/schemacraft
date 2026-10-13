import { useConnectionStore } from "@/features/connection/connectionStore";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { useProjectStore } from "@/features/project/projectStore";
import { useSettingsStore } from "@/shared/settings/settingsStore";

/** Stores reachable from the window object, for automated checks against a running build. */
export interface DevelopmentHooks {
  connection: typeof useConnectionStore;
  project: typeof useProjectStore;
  preferences: typeof usePreferencesStore;
  settings: typeof useSettingsStore;
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
  window.__schemacraft = {
    connection: useConnectionStore,
    project: useProjectStore,
    preferences: usePreferencesStore,
    settings: useSettingsStore,
  };
}
