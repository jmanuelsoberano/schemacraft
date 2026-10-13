import { Database, Download, FolderOpen, PanelLeft, RefreshCw, Save, Workflow } from "lucide-react";
import { useMemo } from "react";

import { useSettingsStore } from "@/shared/settings/settingsStore";

import type { ActionsById, AppAction } from "./action";

export interface AppActions {
  byId: ActionsById;
  list: readonly AppAction[];
}

/** Placeholder for actions whose feature ships in a later milestone. */
const notAvailableYet = (): void => undefined;

export function useAppActions(): AppActions {
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);

  return useMemo(() => {
    const byId: ActionsById = {
      "project.connect": {
        id: "project.connect",
        labelKey: "action.connect",
        icon: Database,
        shortcut: { mod: true, key: "n" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "project.openProject": {
        id: "project.openProject",
        labelKey: "action.openProject",
        icon: FolderOpen,
        shortcut: { mod: true, key: "o" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "project.saveProject": {
        id: "project.saveProject",
        labelKey: "action.saveProject",
        icon: Save,
        shortcut: { mod: true, key: "s" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "project.refreshFromDatabase": {
        id: "project.refreshFromDatabase",
        labelKey: "action.refreshFromDatabase",
        icon: RefreshCw,
        shortcut: { key: "F5" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "diagram.autoLayout": {
        id: "diagram.autoLayout",
        labelKey: "action.autoLayout",
        icon: Workflow,
        shortcut: { mod: true, shift: true, key: "l" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "diagram.export": {
        id: "diagram.export",
        labelKey: "action.export",
        icon: Download,
        shortcut: { mod: true, key: "e" },
        isAvailable: false,
        run: notAvailableYet,
      },
      "view.toggleSidebar": {
        id: "view.toggleSidebar",
        labelKey: "action.toggleSidebar",
        icon: PanelLeft,
        shortcut: { mod: true, key: "b" },
        isAvailable: true,
        run: toggleSidebar,
      },
    };

    return { byId, list: Object.values(byId) };
  }, [toggleSidebar]);
}
