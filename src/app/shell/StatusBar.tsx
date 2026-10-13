import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { classNames } from "@/shared/ui/classNames";

import styles from "./StatusBar.module.css";

export function StatusBar() {
  const { t, tCount } = useI18n();
  const appInfo = useAppInfo();

  return (
    <footer className={styles.statusBar}>
      <span className={styles.item}>
        <span className={styles.dot} aria-hidden="true" />
        {t("statusBar.notConnected")}
      </span>
      <span className={styles.item}>{tCount("statusBar.tables", 0)}</span>
      <span className={styles.item}>{tCount("statusBar.relations", 0)}</span>
      <span className={styles.spacer} />
      <span className={styles.item}>{t("statusBar.zoom", { percent: 100 })}</span>
      <span className={classNames(styles.item, styles.mono)}>
        {appInfo.status === "ready" ? (
          <>
            {t("statusBar.version", { version: appInfo.info.version })}
            {appInfo.info.isDebugBuild ? (
              <span className={styles.badge}>{t("statusBar.devBuild")}</span>
            ) : null}
          </>
        ) : null}
        {appInfo.status === "unavailable" ? t("statusBar.versionUnavailable") : null}
      </span>
    </footer>
  );
}
