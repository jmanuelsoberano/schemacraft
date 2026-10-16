import { useEffect } from "react";

import { useI18n } from "@/shared/i18n/useI18n";
import { closeWindow, setWindowTitle, watchWindowClose } from "@/shared/ipc/nativeWindow";

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
    const name = projectPath === null ? t("project.untitled") : projectDisplayName(projectPath);
    const marker = isDirty ? "• " : "";
    const title = hasProject ? `${marker}${name} – ${t("app.name")}` : t("app.name");
    void setWindowTitle(title);
  }, [projectPath, hasProject, isDirty, t]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void watchWindowClose(() => {
      const { project, guardUnsavedChanges } = useProjectStore.getState();
      if (project?.isDirty !== true) {
        return false;
      }
      guardUnsavedChanges(() => {
        void closeWindow();
      });
      return true;
    }).then((dispose) => {
      if (isDisposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);
}
