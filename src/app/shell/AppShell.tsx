import { useEffect } from "react";
import type { CSSProperties } from "react";

import { useAppActions } from "@/app/actions/useAppActions";
import { useKeyboardShortcuts } from "@/app/actions/useKeyboardShortcuts";
import { AboutDialog } from "@/features/about/AboutDialog";
import { AccessBar } from "@/features/access/AccessBar";
import { AccessReportDialog } from "@/features/access/AccessReportDialog";
import { CanvasContextMenu } from "@/features/canvas/CanvasContextMenu";
import { ConnectionDialog } from "@/features/connection/ConnectionDialog";
import { ExportDialog } from "@/features/export/ExportDialog";
import { CommandPalette } from "@/app/palette/CommandPalette";
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
import { focusEntitiesSearch } from "./entitiesSearch";
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
        <EntitiesSidebar
          notice={
            <AccessBar
              onShowDetails={actions.byId["view.accessReport"].run}
              // The close button disappears with the bar; the search field is the next stop.
              onDismissed={focusEntitiesSearch}
            />
          }
        />
        <SidebarResizer />
      </aside>
      <main className={styles.canvas}>
        <DiagramCanvas actions={actions.byId} />
      </main>
      <StatusBar actions={actions.byId} />
      <ConnectionDialog />
      <UnsavedChangesDialog />
      <AboutDialog />
      <AccessReportDialog />
      <ExportDialog />
      <CommandPalette actions={actions} />
      <CanvasContextMenu />
    </div>
  );
}
