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
import { INSPECTOR_LANDMARK_ID } from "@/features/canvas/canvasFocus";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { focusEntitiesSearch } from "@/features/canvas/entitiesSearch";
import { ConnectionDialog } from "@/features/connection/ConnectionDialog";
import { ExportDialog } from "@/features/export/ExportDialog";
import { InspectorPanel } from "@/features/inspector/InspectorPanel";
import { CommandPalette } from "@/app/palette/CommandPalette";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { UnsavedChangesDialog } from "@/features/project/UnsavedChangesDialog";
import { useProjectWindow } from "@/features/project/useProjectWindow";
import { useI18n } from "@/shared/i18n/useI18n";
import {
  INSPECTOR_WIDTH_LIMITS,
  SIDEBAR_WIDTH_LIMITS,
  useSettingsStore,
} from "@/shared/settings/settingsStore";
import { PanelResizer } from "@/shared/ui/PanelResizer";
import { classNames } from "@/shared/ui/classNames";

import styles from "./AppShell.module.css";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { WelcomeOverlay } from "./WelcomeOverlay";
import { fitSidePanels, useWindowWidth } from "./sidePanelWidths";
import { useDesktopShellGuards } from "./useDesktopShellGuards";

/**
 * Four-region layout: top bar, the resizable entities panel and the Inspector on either side of
 * the canvas, status bar. The canvas and both panels live in the features; the shell only places
 * them, as named landmarks that turn inert while collapsed, sizes the panels so the canvas keeps
 * its room in a narrow window (`fitSidePanels`), and hands over what belongs to the
 * application: the welcome screen, the development hook and the registry action the context menu
 * repeats. The Inspector is a complementary landmark, never a dialog, so shortcuts keep working
 * while it is open.
 */
export function AppShell() {
  const { t } = useI18n();
  const actions = useAppActions();
  const isSidebarOpen = useSettingsStore((state) => state.isSidebarOpen);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const inspectorWidth = useSettingsStore((state) => state.inspectorWidth);
  const setInspectorWidth = useSettingsStore((state) => state.setInspectorWidth);
  const isInspectorOpen = useCanvasUiStore((state) => state.isInspectorOpen);
  const windowWidth = useWindowWidth();
  useKeyboardShortcuts(actions.list);
  useDesktopShellGuards();
  useProjectWindow();

  useEffect(() => {
    void usePreferencesStore.getState().load();
  }, []);

  // The panels take what the window leaves beside the canvas; the remembered widths stay as
  // chosen, and a width dragged past what fits is remembered as the width the panel took.
  const panels = fitSidePanels(
    { width: sidebarWidth, limits: SIDEBAR_WIDTH_LIMITS, isOpen: isSidebarOpen },
    { width: inspectorWidth, limits: INSPECTOR_WIDTH_LIMITS, isOpen: isInspectorOpen },
    windowWidth,
  );
  const shellStyle = {
    "--sidebar-width": `${panels.sidebar.width}px`,
    "--inspector-width": `${panels.inspector.width}px`,
  } as CSSProperties;
  const showAll = actions.byId["diagram.showAll"];
  const toggleInspector = actions.byId["view.toggleInspector"];

  return (
    <div className={styles.shell} style={shellStyle}>
      <TopBar actions={actions.byId} />
      <aside
        className={classNames(styles.sidebar, !isSidebarOpen && styles.sidebarCollapsed)}
        inert={!isSidebarOpen}
        aria-label={t("sidebar.title")}
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
        <PanelResizer
          edge="end"
          label={t("sidebar.resize")}
          width={panels.sidebar.width}
          limits={panels.sidebar.limits}
          onWidthChange={(width) => {
            setSidebarWidth(Math.min(width, panels.sidebar.limits.max));
          }}
          onReset={() => {
            setSidebarWidth(SIDEBAR_WIDTH_LIMITS.default);
          }}
        />
      </aside>
      <main className={styles.canvas}>
        <DiagramCanvas
          emptyState={<WelcomeOverlay actions={actions.byId} />}
          onFlowInit={exposeFlowInstance}
        />
      </main>
      <aside
        id={INSPECTOR_LANDMARK_ID}
        className={classNames(styles.inspector, !isInspectorOpen && styles.inspectorCollapsed)}
        inert={!isInspectorOpen}
        aria-label={t("inspector.title")}
      >
        <InspectorPanel
          toggleShortcutHint={
            toggleInspector.shortcut
              ? formatShortcut(toggleInspector.shortcut, isApplePlatform())
              : undefined
          }
          // The "Why?" links run the registry's report action, like the access bar's button.
          onShowAccessReport={actions.byId["view.accessReport"].run}
          resizer={
            <PanelResizer
              edge="start"
              label={t("inspector.resize")}
              controls={INSPECTOR_LANDMARK_ID}
              width={panels.inspector.width}
              limits={panels.inspector.limits}
              onWidthChange={(width) => {
                setInspectorWidth(Math.min(width, panels.inspector.limits.max));
              }}
              onReset={() => {
                setInspectorWidth(INSPECTOR_WIDTH_LIMITS.default);
              }}
            />
          }
        />
      </aside>
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
