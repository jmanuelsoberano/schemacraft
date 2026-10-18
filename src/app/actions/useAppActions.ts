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
  KeyRound,
  Languages,
  Layers,
  Maximize2,
  Monitor,
  Moon,
  Network,
  Orbit,
  PanelLeft,
  PanelRight,
  Redo2,
  RefreshCw,
  Rows3,
  Save,
  SaveAll,
  ScrollText,
  Search,
  ShieldHalf,
  Sun,
  Table2,
  Undo2,
  Workflow,
} from "lucide-react";
import { useMemo } from "react";

import { useAboutStore } from "@/features/about/aboutStore";
import { useAccessReportStore } from "@/features/access/accessReportStore";
import {
  applyLastLayout,
  applyLayout,
  setCollapsedForAll,
  showAllEntities,
} from "@/features/canvas/canvasActions";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { focusEntitiesSearch } from "@/features/canvas/entitiesSearch";
import { useConnectionStore } from "@/features/connection/connectionStore";
import { useExportStore } from "@/features/export/exportStore";
import { useProjectStore } from "@/features/project/projectStore";
import { usePaletteStore } from "@/app/palette/paletteStore";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { useSettingsStore } from "@/shared/settings/settingsStore";

import type { MessageKey } from "@/shared/i18n/messages/en";

import type { ActionsById, AppAction } from "./action";

export interface AppActions {
  byId: ActionsById;
  list: readonly AppAction[];
}

export function useAppActions(): AppActions {
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar);
  const setThemePreference = useSettingsStore((state) => state.setThemePreference);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const openConnectionDialog = useConnectionStore((state) => state.openDialog);
  const openExportDialog = useExportStore((state) => state.open);
  const refreshFromDatabase = useConnectionStore((state) => state.refresh);
  const hasProject = useProjectStore((state) => state.project !== null);
  const isReadOnly = useProjectStore((state) => state.project?.isReadOnly ?? false);
  const guardUnsavedChanges = useProjectStore((state) => state.guardUnsavedChanges);
  const openProject = useProjectStore((state) => state.openProject);
  const saveProject = useProjectStore((state) => state.saveProject);
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs);
  const setDetailLevel = useProjectStore((state) => state.setDetailLevel);
  const openAbout = useAboutStore((state) => state.open);
  const openLogFolder = useAboutStore((state) => state.openLogFolder);
  const appInfo = useAppInfo();
  const hasLogFolder = appInfo.status === "ready" && appInfo.info.logDirectory !== null;
  const openAccessReport = useAccessReportStore((state) => state.open);
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
  const toggleInspector = useCanvasUiStore((state) => state.toggleInspector);
  const togglePalette = usePaletteStore((state) => state.toggle);
  const canLayout = hasProject && !isLayoutRunning;
  // A project a newer version wrote is shown but never written: saving would drop what this
  // version does not understand, and a refresh would replace it.
  const canWriteProject = hasProject && !isReadOnly;

  return useMemo(() => {
    const layoutUnavailableReason: MessageKey = hasProject
      ? "action.unavailable.layoutRunning"
      : "action.unavailable.noProject";
    const writeUnavailableReason: MessageKey | undefined = canWriteProject
      ? undefined
      : hasProject
        ? "action.unavailable.readOnly"
        : "action.unavailable.noProject";
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
        isAvailable: canWriteProject,
        unavailableReason: writeUnavailableReason,
        run: () => {
          void saveProject();
        },
      },
      "project.saveProjectAs": {
        id: "project.saveProjectAs",
        labelKey: "action.saveProjectAs",
        icon: SaveAll,
        shortcut: { mod: true, shift: true, key: "s" },
        isAvailable: canWriteProject,
        unavailableReason: writeUnavailableReason,
        run: () => {
          void saveProjectAs();
        },
      },
      "project.refreshFromDatabase": {
        id: "project.refreshFromDatabase",
        labelKey: "action.refreshFromDatabase",
        icon: RefreshCw,
        shortcut: { key: "F5" },
        isAvailable: canWriteProject,
        unavailableReason: writeUnavailableReason,
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
        unavailableReason: canLayout ? undefined : layoutUnavailableReason,
        run: () => {
          void applyLastLayout();
        },
      },
      "diagram.layoutLayered": {
        id: "diagram.layoutLayered",
        labelKey: "action.layoutLayered",
        icon: Network,
        isAvailable: canLayout,
        unavailableReason: canLayout ? undefined : layoutUnavailableReason,
        run: () => {
          void applyLayout({ kind: "layered", direction: "down" });
        },
      },
      "diagram.layoutLayeredHorizontal": {
        id: "diagram.layoutLayeredHorizontal",
        labelKey: "action.layoutLayeredHorizontal",
        icon: GitFork,
        isAvailable: canLayout,
        unavailableReason: canLayout ? undefined : layoutUnavailableReason,
        run: () => {
          void applyLayout({ kind: "layered", direction: "right" });
        },
      },
      "diagram.layoutOrganic": {
        id: "diagram.layoutOrganic",
        labelKey: "action.layoutOrganic",
        icon: Workflow,
        isAvailable: canLayout,
        unavailableReason: canLayout ? undefined : layoutUnavailableReason,
        run: () => {
          void applyLayout({ kind: "organic" });
        },
      },
      "diagram.layoutRadial": {
        id: "diagram.layoutRadial",
        labelKey: "action.layoutRadial",
        icon: Orbit,
        isAvailable: canLayout,
        unavailableReason: canLayout ? undefined : layoutUnavailableReason,
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
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: requestFit,
      },
      // Ctrl+1, 2 and 3 follow the segmented control from left to right, next to Ctrl+0 for fit.
      "view.detailCompact": {
        id: "view.detailCompact",
        labelKey: "action.detailCompact",
        icon: Rows3,
        shortcut: { mod: true, key: "1" },
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: () => {
          setDetailLevel("compact");
        },
      },
      "view.detailKeys": {
        id: "view.detailKeys",
        labelKey: "action.detailKeys",
        icon: KeyRound,
        shortcut: { mod: true, key: "2" },
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: () => {
          setDetailLevel("keys");
        },
      },
      "view.detailFull": {
        id: "view.detailFull",
        labelKey: "action.detailFull",
        icon: Table2,
        shortcut: { mod: true, key: "3" },
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: () => {
          setDetailLevel("full");
        },
      },
      "diagram.showAll": {
        id: "diagram.showAll",
        labelKey: "action.showAll",
        icon: Layers,
        shortcut: { mod: true, shift: true, key: "h" },
        isAvailable: hasHidden,
        unavailableReason: hasHidden ? undefined : "action.unavailable.nothingHidden",
        run: showAllEntities,
      },
      "diagram.collapseAll": {
        id: "diagram.collapseAll",
        labelKey: "action.collapseAll",
        icon: ChevronsDownUp,
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: () => {
          setCollapsedForAll(true);
        },
      },
      "diagram.expandAll": {
        id: "diagram.expandAll",
        labelKey: "action.expandAll",
        icon: ChevronsUpDown,
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
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
        unavailableReason: canUndo ? undefined : "action.unavailable.nothingToUndo",
        skipWhenEditing: true,
        run: undo,
      },
      "edit.redo": {
        id: "edit.redo",
        labelKey: "action.redo",
        icon: Redo2,
        shortcut: { mod: true, key: "y" },
        isAvailable: canRedo,
        unavailableReason: canRedo ? undefined : "action.unavailable.nothingToRedo",
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
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
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
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
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
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: focusEntitiesSearch,
      },
      // Available with full access too: the report then says that the whole schema was read.
      "view.accessReport": {
        id: "view.accessReport",
        labelKey: "action.accessReport",
        icon: ShieldHalf,
        shortcut: { mod: true, shift: true, key: "a" },
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: openAccessReport,
      },
      "view.toggleSidebar": {
        id: "view.toggleSidebar",
        labelKey: "action.toggleSidebar",
        icon: PanelLeft,
        shortcut: { mod: true, key: "b" },
        isAvailable: true,
        run: toggleSidebar,
      },
      // Opened by the shortcut, the top-bar button or the palette, the Inspector takes focus;
      // closing it hands focus back.
      "view.toggleInspector": {
        id: "view.toggleInspector",
        labelKey: "action.toggleInspector",
        icon: PanelRight,
        shortcut: { mod: true, key: "i" },
        isAvailable: hasProject,
        unavailableReason: hasProject ? undefined : "action.unavailable.noProject",
        run: () => {
          toggleInspector({ focus: true });
        },
      },
      // Preferences are commands too, so the palette can switch them without a shortcut.
      "settings.theme.system": {
        id: "settings.theme.system",
        labelKey: "action.themeSystem",
        icon: Monitor,
        isAvailable: true,
        run: () => {
          setThemePreference("system");
        },
      },
      "settings.theme.light": {
        id: "settings.theme.light",
        labelKey: "action.themeLight",
        icon: Sun,
        isAvailable: true,
        run: () => {
          setThemePreference("light");
        },
      },
      "settings.theme.dark": {
        id: "settings.theme.dark",
        labelKey: "action.themeDark",
        icon: Moon,
        isAvailable: true,
        run: () => {
          setThemePreference("dark");
        },
      },
      "settings.language.en": {
        id: "settings.language.en",
        labelKey: "action.languageEn",
        icon: Languages,
        isAvailable: true,
        run: () => {
          setLocale("en");
        },
      },
      "settings.language.es": {
        id: "settings.language.es",
        labelKey: "action.languageEs",
        icon: Languages,
        isAvailable: true,
        run: () => {
          setLocale("es");
        },
      },
      "help.about": {
        id: "help.about",
        labelKey: "action.about",
        icon: Info,
        shortcut: { key: "F1" },
        isAvailable: true,
        run: openAbout,
      },
      // For a bug report, from the palette; the about dialog shows the folder and opens it too.
      "help.openLogFolder": {
        id: "help.openLogFolder",
        labelKey: "action.openLogFolder",
        icon: ScrollText,
        isAvailable: hasLogFolder,
        unavailableReason: hasLogFolder ? undefined : "action.unavailable.noLogFolder",
        run: () => {
          void openLogFolder();
        },
      },
    };

    return { byId, list: Object.values(byId) };
  }, [
    toggleSidebar,
    setThemePreference,
    setLocale,
    openConnectionDialog,
    openExportDialog,
    refreshFromDatabase,
    hasProject,
    canWriteProject,
    guardUnsavedChanges,
    openProject,
    saveProject,
    saveProjectAs,
    setDetailLevel,
    openAbout,
    openLogFolder,
    hasLogFolder,
    openAccessReport,
    canUndo,
    canRedo,
    hasHidden,
    undo,
    redo,
    canLayout,
    requestFit,
    selectedKeys,
    toggleInspector,
    togglePalette,
  ]);
}
