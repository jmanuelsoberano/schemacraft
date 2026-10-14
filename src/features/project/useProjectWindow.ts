import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { useI18n } from "@/shared/i18n/useI18n";

import { projectDisplayName } from "./projectPaths";
import { useProjectStore } from "./projectStore";

/**
 * Keeps the native window in step with the project: its title names the file and flags unsaved
 * changes, and closing the window with unsaved changes asks first. Does nothing outside Tauri.
 */
export function useProjectWindow(): void {
  const { t } = useI18n();
  const projectPath = useProjectStore((state) => state.project?.path ?? null);
  const hasProject = useProjectStore((state) => state.project !== null);
  const isDirty = useProjectStore((state) => state.project?.isDirty ?? false);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    const name = projectPath === null ? t("project.untitled") : projectDisplayName(projectPath);
    const marker = isDirty ? "• " : "";
    const title = hasProject ? `${marker}${name} – ${t("app.name")}` : t("app.name");
    getCurrentWindow()
      .setTitle(title)
      .catch((error: unknown) => {
        console.warn("Could not update the window title", error);
      });
  }, [projectPath, hasProject, isDirty, t]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    getCurrentWindow()
      .onCloseRequested((event) => {
        const { project, guardUnsavedChanges } = useProjectStore.getState();
        if (project?.isDirty !== true) {
          return;
        }
        event.preventDefault();
        guardUnsavedChanges(() => {
          getCurrentWindow()
            .destroy()
            .catch((error: unknown) => {
              console.warn("Could not close the window", error);
            });
        });
      })
      .then((dispose) => {
        if (isDisposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not watch the window close request", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);
}
