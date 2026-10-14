import {
  ChevronsDownUp,
  ChevronsUpDown,
  Command,
  Database,
  FileText,
  Download,
  FolderOpen,
  GitFork,
  Info,
  Layers,
  Maximize2,
  Network,
  Orbit,
  PanelLeft,
  Redo2,
  RefreshCw,
  Save,
  SaveAll,
  Search,
  Undo2,
  Workflow,
} from "lucide-react";
import { useMemo } from "react";

import { focusEntitiesSearch } from "@/app/shell/entitiesSearch";
import { useAboutStore } from "@/features/about/aboutStore";
import {
  applyLastLayout,
  applyLayout,
  setCollapsedForAll,
  showAllEntities,
} from "@/features/canvas/canvasActions";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useConnectionStore } from "@/features/connection/connectionStore";
import { useExportStore } from "@/features/export/exportStore";
import { useProjectStore } from "@/features/project/projectStore";
import { usePaletteStore } from "@/features/palette/paletteStore";
import { useSettingsStore } from "@/shared/settings/settingsStore";

import type { ActionsById, AppAction } from "./action";

export interface AppActions {
  byId: ActionsById;
  list: readonly AppAction[];
}

export function useAppActions(): AppActions {
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
  const openConnectionDialog = useConnectionStore((state) => state.openDialog);
  const openExportDialog = useExportStore((state) => state.open);
  const refreshFromDatabase = useConnectionStore((state) => state.refresh);
  const hasProject = useProjectStore((state) => state.project !== null);
  const guardUnsavedChanges = useProjectStore((state) => state.guardUnsavedChanges);
  const openProject = useProjectStore((state) => state.openProject);
  const saveProject = useProjectStore((state) => state.saveProject);
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs);
  const openAbout = useAboutStore((state) => state.open);
  const canUndo = useProjectStore((state) => state.history.past.length > 0);
  const canRedo = useProjectStore((state) => state.history.future.length > 0);
  const hasHidden = useProjectStore(
    (state) => state.project?.content.canvas.nodes.some((node) => node.isHidden) ?? false,
  );
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const isLayoutRunning = useCanvasUiStore((state) => state.isLayoutRunning);
  const requestFit = useCanvasUiStore((state) => state.requestFit);
  const selectedKeys = useCanvasUiStore((state) => state.selectedKeys);
  const togglePalette = usePaletteStore((state) => state.toggle);
  const canLayout = hasProject && !isLayoutRunning;

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
        isAvailable: canLayout,
        run: () => {
          void applyLastLayout();
        },
      },
      "diagram.layoutLayered": {
        id: "diagram.layoutLayered",
        labelKey: "action.layoutLayered",
        icon: Network,
        isAvailable: canLayout,
        run: () => {
          void applyLayout({ kind: "layered", direction: "down" });
        },
      },
      "diagram.layoutLayeredHorizontal": {
        id: "diagram.layoutLayeredHorizontal",
        labelKey: "action.layoutLayeredHorizontal",
        icon: GitFork,
        isAvailable: canLayout,
        run: () => {
          void applyLayout({ kind: "layered", direction: "right" });
        },
      },
      "diagram.layoutOrganic": {
        id: "diagram.layoutOrganic",
        labelKey: "action.layoutOrganic",
        icon: Workflow,
        isAvailable: canLayout,
        run: () => {
          void applyLayout({ kind: "organic" });
        },
      },
      "diagram.layoutRadial": {
        id: "diagram.layoutRadial",
        labelKey: "action.layoutRadial",
        icon: Orbit,
        isAvailable: canLayout,
        run: () => {
          void applyLayout({ kind: "radial", focusId: selectedKeys[0] ?? null });
        },
      },
      "diagram.fitView": {
        id: "diagram.fitView",
        labelKey: "action.fitView",
        icon: Maximize2,
        shortcut: { mod: true, key: "0" },
        isAvailable: hasProject,
        run: requestFit,
      },
      "diagram.showAll": {
        id: "diagram.showAll",
        labelKey: "action.showAll",
        icon: Layers,
        shortcut: { mod: true, shift: true, key: "h" },
        isAvailable: hasHidden,
        run: showAllEntities,
      },
      "diagram.collapseAll": {
        id: "diagram.collapseAll",
        labelKey: "action.collapseAll",
        icon: ChevronsDownUp,
        isAvailable: hasProject,
        run: () => {
          setCollapsedForAll(true);
        },
      },
      "diagram.expandAll": {
        id: "diagram.expandAll",
        labelKey: "action.expandAll",
        icon: ChevronsUpDown,
        isAvailable: hasProject,
        run: () => {
          setCollapsedForAll(false);
        },
      },
      "edit.undo": {
        id: "edit.undo",
        labelKey: "action.undo",
        icon: Undo2,
        shortcut: { mod: true, key: "z" },
        isAvailable: canUndo,
        skipWhenEditing: true,
        run: undo,
      },
      "edit.redo": {
        id: "edit.redo",
        labelKey: "action.redo",
        icon: Redo2,
        shortcut: { mod: true, key: "y" },
        isAvailable: canRedo,
        skipWhenEditing: true,
        run: redo,
      },
      "view.commandPalette": {
        id: "view.commandPalette",
        labelKey: "action.commandPalette",
        icon: Command,
        shortcut: { mod: true, key: "k" },
        isAvailable: true,
        run: togglePalette,
      },
      "diagram.export": {
        id: "diagram.export",
        labelKey: "action.export",
        icon: Download,
        shortcut: { mod: true, key: "e" },
        isAvailable: hasProject,
        run: () => {
          openExportDialog();
        },
      },
      // Ctrl+P is what people press to print; the PDF export is the answer in a diagram tool.
      "diagram.exportPdf": {
        id: "diagram.exportPdf",
        labelKey: "action.exportPdf",
        icon: FileText,
        shortcut: { mod: true, key: "p" },
        isAvailable: hasProject,
        run: () => {
          openExportDialog({ format: "pdf" });
        },
      },
      "view.searchEntities": {
        id: "view.searchEntities",
        labelKey: "action.searchEntities",
        icon: Search,
        shortcut: { mod: true, key: "f" },
        isAvailable: hasProject,
        run: focusEntitiesSearch,
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
    openExportDialog,
    refreshFromDatabase,
    hasProject,
    guardUnsavedChanges,
    openProject,
    saveProject,
    saveProjectAs,
    openAbout,
    canUndo,
    canRedo,
    hasHidden,
    undo,
    redo,
    canLayout,
    requestFit,
    selectedKeys,
    togglePalette,
  ]);
}
