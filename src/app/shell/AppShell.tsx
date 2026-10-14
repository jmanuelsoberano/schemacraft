import { useEffect } from "react";
import type { CSSProperties } from "react";

import { useAppActions } from "@/app/actions/useAppActions";
import { useKeyboardShortcuts } from "@/app/actions/useKeyboardShortcuts";
import { AboutDialog } from "@/features/about/AboutDialog";
import { CanvasContextMenu } from "@/features/canvas/CanvasContextMenu";
import { ConnectionDialog } from "@/features/connection/ConnectionDialog";
import { ExportDialog } from "@/features/export/ExportDialog";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { UnsavedChangesDialog } from "@/features/project/UnsavedChangesDialog";
import { useProjectWindow } from "@/features/project/useProjectWindow";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { classNames } from "@/shared/ui/classNames";

import styles from "./AppShell.module.css";
import { DiagramCanvas } from "./DiagramCanvas";
import { EntitiesSidebar } from "./EntitiesSidebar";
import { SidebarResizer } from "./SidebarResizer";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { useDesktopShellGuards } from "./useDesktopShellGuards";

/** Three-region layout: top bar, resizable entities panel beside the canvas, status bar. */
export function AppShell() {
  const actions = useAppActions();
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  useKeyboardShortcuts(actions.list);
  useDesktopShellGuards();
  useProjectWindow();

  useEffect(() => {
    void usePreferencesStore.getState().load();
  }, []);

  const shellStyle = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  return (
    <div className={styles.shell} style={shellStyle}>
      <TopBar actions={actions.byId} />
      <aside
        className={classNames(styles.sidebar, !isSidebarOpen && styles.sidebarCollapsed)}
        inert={!isSidebarOpen}
      >
        <EntitiesSidebar />
        <SidebarResizer />
      </aside>
      <main className={styles.canvas}>
        <DiagramCanvas actions={actions.byId} />
      </main>
      <StatusBar />
      <ConnectionDialog />
      <UnsavedChangesDialog />
      <AboutDialog />
      <ExportDialog />
      <CommandPalette actions={actions} />
      <CanvasContextMenu />
    </div>
  );
}
