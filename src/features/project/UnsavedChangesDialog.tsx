import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";

import styles from "./UnsavedChangesDialog.module.css";
import { projectDisplayName } from "./projectPaths";

/** Asks before an action would throw away unsaved changes of the open project. */
export function UnsavedChangesDialog() {
  const { t } = useI18n();
  const isOpen = useProjectStore((state) => state.pendingDiscard !== null);
  const projectPath = useProjectStore((state) => state.project?.path ?? null);
  const confirmDiscard = useProjectStore((state) => state.confirmDiscard);
  const cancelDiscard = useProjectStore((state) => state.cancelDiscard);

  const name = projectPath === null ? t("project.untitled") : projectDisplayName(projectPath);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          cancelDiscard();
        }
      }}
      title={t("project.discard.title")}
      description={t("project.discard.description", { name })}
      closeLabel={t("connection.action.close")}
      width={440}
      footer={
        <>
          <Button onClick={cancelDiscard}>{t("project.discard.cancel")}</Button>
          <Button variant="primary" onClick={confirmDiscard}>
            {t("project.discard.confirm")}
          </Button>
        </>
      }
    >
      <p className={styles.note}>{t("project.discard.note")}</p>
    </Dialog>
  );
}
