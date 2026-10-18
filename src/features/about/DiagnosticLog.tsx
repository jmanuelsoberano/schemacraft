import { FolderOpen } from "lucide-react";

import { describeOperationError } from "@/shared/errors/describeOperationError";
import { useI18n } from "@/shared/i18n/useI18n";
import type { AppInfoState } from "@/shared/ipc/useAppInfo";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";

import styles from "./AboutDialog.module.css";
import { useAboutStore } from "./aboutStore";

/**
 * The "Diagnostic log" row of the about dialog: where the log is, a button that opens its
 * folder, and what it holds. Without a folder it says why, and a failure to open it is shown
 * below (ADR-041).
 */
export function DiagnosticLog({ appInfo }: { appInfo: AppInfoState }) {
  const translator = useI18n();
  const { t } = translator;
  const failure = useAboutStore((state) => state.logFolderFailure);
  const openLogFolder = useAboutStore((state) => state.openLogFolder);
  const directory = appInfo.status === "ready" ? appInfo.info.logDirectory : null;
  const presentation = failure ? describeOperationError(failure, translator) : null;

  return (
    <>
      <dt>{t("about.log")}</dt>
      <dd className={styles.log}>
        {directory !== null ? (
          <>
            <span className={styles.mono}>{directory}</span>
            <span>
              <Button
                leadingIcon={FolderOpen}
                onClick={() => {
                  void openLogFolder();
                }}
              >
                {t("about.log.open")}
              </Button>
            </span>
          </>
        ) : appInfo.status === "loading" ? null : (
          <span className={styles.logMissing}>
            {t(appInfo.status === "ready" ? "about.log.none" : "about.log.unavailable")}
          </span>
        )}
        <span className={styles.logNote}>{t("about.log.privacy")}</span>
        {presentation ? (
          <Alert variant="danger" title={presentation.title} detail={presentation.detail}>
            {presentation.hint}
          </Alert>
        ) : null}
      </dd>
    </>
  );
}
