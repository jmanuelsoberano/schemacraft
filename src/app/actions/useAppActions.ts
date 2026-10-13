import {
  Database,
  Download,
  FolderOpen,
  Info,
  PanelLeft,
  RefreshCw,
  Save,
  SaveAll,
  Workflow,
} from "lucide-react";
import { useMemo } from "react";

import { useAboutStore } from "@/features/about/aboutStore";
import { useConnectionStore } from "@/features/connection/connectionStore";
import { useProjectStore } from "@/features/project/projectStore";
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
  const openConnectionDialog = useConnectionStore((state) => state.openDialog);
  const refreshFromDatabase = useConnectionStore((state) => state.refresh);
  const hasProject = useProjectStore((state) => state.project !== null);
  const guardUnsavedChanges = useProjectStore((state) => state.guardUnsavedChanges);
  const openProject = useProjectStore((state) => state.openProject);
  const saveProject = useProjectStore((state) => state.saveProject);
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs);
  const openAbout = useAboutStore((state) => state.open);

  return useMemo(() => {
    const byId: ActionsById = {
      "project.connect": {
        id: "project.connect",
        labelKey: "action.connect",
        icon: Database,
        shortcut: { mod: true, key: "n" },
        isAvailable: true,
        // A new connection replaces the open project, so unsaved changes are confirmed first.
        run: () => {
          guardUnsavedChanges(openConnectionDialog);
        },
      },
      "project.openProject": {
        id: "project.openProject",
        labelKey: "action.openProject",
        icon: FolderOpen,
        shortcut: { mod: true, key: "o" },
        isAvailable: true,
        run: () => {
          openProject();
        },
      },
      "project.saveProject": {
        id: "project.saveProject",
        labelKey: "action.saveProject",
        icon: Save,
        shortcut: { mod: true, key: "s" },
        isAvailable: hasProject,
        run: () => {
          void saveProject();
        },
      },
      "project.saveProjectAs": {
        id: "project.saveProjectAs",
        labelKey: "action.saveProjectAs",
        icon: SaveAll,
        shortcut: { mod: true, shift: true, key: "s" },
        isAvailable: hasProject,
        run: () => {
          void saveProjectAs();
        },
      },
      "project.refreshFromDatabase": {
        id: "project.refreshFromDatabase",
        labelKey: "action.refreshFromDatabase",
        icon: RefreshCw,
        shortcut: { key: "F5" },
        isAvailable: hasProject,
        run: () => {
          void refreshFromDatabase();
        },
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
      "help.about": {
        id: "help.about",
        labelKey: "action.about",
        icon: Info,
        shortcut: { key: "F1" },
        isAvailable: true,
        run: openAbout,
      },
    };

    return { byId, list: Object.values(byId) };
  }, [
    toggleSidebar,
    openConnectionDialog,
    refreshFromDatabase,
    hasProject,
    guardUnsavedChanges,
    openProject,
    saveProject,
    saveProjectAs,
    openAbout,
  ]);
}
