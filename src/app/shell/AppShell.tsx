import { useEffect } from "react";

import { useAppActions } from "@/app/actions/useAppActions";
import { useKeyboardShortcuts } from "@/app/actions/useKeyboardShortcuts";
import { AboutDialog } from "@/features/about/AboutDialog";
import { ConnectionDialog } from "@/features/connection/ConnectionDialog";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { UnsavedChangesDialog } from "@/features/project/UnsavedChangesDialog";
import { useProjectWindow } from "@/features/project/useProjectWindow";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { classNames } from "@/shared/ui/classNames";

import styles from "./AppShell.module.css";
import { DiagramCanvas } from "./DiagramCanvas";
import { EntitiesSidebar } from "./EntitiesSidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

/** Three-region layout: top bar, collapsible entities panel beside the canvas, status bar. */
export function AppShell() {
  const actions = useAppActions();
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);
  useKeyboardShortcuts(actions.list);
  useProjectWindow();

  useEffect(() => {
    void usePreferencesStore.getState().load();
  }, []);

  return (
    <div className={styles.shell}>
      <TopBar actions={actions.byId} />
      <aside
        className={classNames(styles.sidebar, !isSidebarOpen && styles.sidebarCollapsed)}
        inert={!isSidebarOpen}
      >
        <EntitiesSidebar />
      </aside>
      <main className={styles.canvas}>
        <DiagramCanvas actions={actions.byId} />
      </main>
      <StatusBar />
      <ConnectionDialog />
      <UnsavedChangesDialog />
      <AboutDialog />
    </div>
  );
}
