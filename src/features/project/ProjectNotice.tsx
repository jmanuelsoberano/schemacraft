import { describeOperationError } from "@/shared/errors/describeOperationError";
import { useI18n } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";

import styles from "./ProjectNotice.module.css";
import { useProjectStore } from "./projectStore";

/** Non-blocking report of a failed open or save, shown over the canvas until dismissed. */
export function ProjectNotice() {
  const translator = useI18n();
  const { t } = translator;
  const failure = useProjectStore((state) => state.failure);
  const dismissFailure = useProjectStore((state) => state.dismissFailure);

  if (failure === null) {
    return null;
  }

  const presentation = describeOperationError(failure.error, translator);

  return (
    <div className={styles.notice}>
      <Alert
        variant="danger"
        title={
          failure.operation === "open"
            ? t("project.notice.openFailed")
            : t("project.notice.saveFailed")
        }
        detail={presentation.detail}
        action={<Button onClick={dismissFailure}>{t("project.notice.dismiss")}</Button>}
      >
        {presentation.title}. {presentation.hint}
      </Alert>
    </div>
  );
}
