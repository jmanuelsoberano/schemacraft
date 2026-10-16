import { useEffect } from "react";
import type { CSSProperties } from "react";

import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import { useAppActions } from "@/app/actions/useAppActions";
import { useKeyboardShortcuts } from "@/app/actions/useKeyboardShortcuts";
import { exposeFlowInstance } from "@/app/developmentHooks";
import { AboutDialog } from "@/features/about/AboutDialog";
import { AccessBar } from "@/features/access/AccessBar";
import { AccessReportDialog } from "@/features/access/AccessReportDialog";
import { CanvasContextMenu } from "@/features/canvas/CanvasContextMenu";
import { DiagramCanvas } from "@/features/canvas/DiagramCanvas";
import { EntitiesSidebar } from "@/features/canvas/EntitiesSidebar";
import { focusEntitiesSearch } from "@/features/canvas/entitiesSearch";
import { ConnectionDialog } from "@/features/connection/ConnectionDialog";
import { ExportDialog } from "@/features/export/ExportDialog";
import { CommandPalette } from "@/app/palette/CommandPalette";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { UnsavedChangesDialog } from "@/features/project/UnsavedChangesDialog";
import { useProjectWindow } from "@/features/project/useProjectWindow";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { classNames } from "@/shared/ui/classNames";

import styles from "./AppShell.module.css";
import { SidebarResizer } from "./SidebarResizer";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { WelcomeOverlay } from "./WelcomeOverlay";
import { useDesktopShellGuards } from "./useDesktopShellGuards";

/**
 * Three-region layout: top bar, resizable entities panel beside the canvas, status bar. The
 * canvas and the panel live in features/canvas; the shell only places them and hands over what
 * belongs to the application: the welcome screen, the development hook and the registry action
 * the context menu repeats.
 */
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
  const showAll = actions.byId["diagram.showAll"];

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
        <DiagramCanvas
          emptyState={<WelcomeOverlay actions={actions.byId} />}
          onFlowInit={exposeFlowInstance}
        />
      </main>
      <StatusBar actions={actions.byId} />
      <ConnectionDialog />
      <UnsavedChangesDialog />
      <AboutDialog />
      <AccessReportDialog />
      <ExportDialog />
      <CommandPalette actions={actions} />
      <CanvasContextMenu
        showAll={{
          labelKey: showAll.labelKey,
          isAvailable: showAll.isAvailable,
          shortcutHint: showAll.shortcut
            ? formatShortcut(showAll.shortcut, isApplePlatform())
            : undefined,
          run: showAll.run,
        }}
      />
    </div>
  );
}
