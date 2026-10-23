import { useAccessReportStore } from "@/features/access/accessReportStore";
import * as canvasActions from "@/features/canvas/canvasActions";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useConnectionStore } from "@/features/connection/connectionStore";
import { useComparisonStore } from "@/features/comparison/comparisonStore";
import { useDependencyStore } from "@/features/dependencies/dependencyStore";
import { usePerspectiveUiStore } from "@/features/perspectives/perspectiveUiStore";
import { useExportStore } from "@/features/export/exportStore";
import { usePaletteStore } from "@/app/palette/paletteStore";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { useProjectStore } from "@/features/project/projectStore";
import { useSettingsStore } from "@/shared/settings/settingsStore";

/** Stores reachable from the window object, for automated checks against a running build. */
export interface DevelopmentHooks {
  connection: typeof useConnectionStore;
  project: typeof useProjectStore;
  preferences: typeof usePreferencesStore;
  settings: typeof useSettingsStore;
  canvasUi: typeof useCanvasUiStore;
  canvasActions: typeof canvasActions;
  palette: typeof usePaletteStore;
  exportStore: typeof useExportStore;
  accessReport: typeof useAccessReportStore;
  comparison: typeof useComparisonStore;
  dependencies: typeof useDependencyStore;
  perspectives: typeof usePerspectiveUiStore;
  /** The React Flow instance once the canvas initialised, for scripted checks. */
  flow: unknown;
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
    flow: null,
    connection: useConnectionStore,
    project: useProjectStore,
    preferences: usePreferencesStore,
    settings: useSettingsStore,
    canvasUi: useCanvasUiStore,
    canvasActions,
    palette: usePaletteStore,
    exportStore: useExportStore,
    accessReport: useAccessReportStore,
    comparison: useComparisonStore,
    dependencies: useDependencyStore,
    perspectives: usePerspectiveUiStore,
  };
}

/** Records the React Flow instance on the development hooks; a no-op in production. */
export function exposeFlowInstance(instance: unknown): void {
  if (window.__schemacraft !== undefined) {
    window.__schemacraft.flow = instance;
  }
}
