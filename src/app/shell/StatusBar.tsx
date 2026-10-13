import { useProjectStore } from "@/features/project/projectStore";
import { describeSavedConnection } from "@/features/project/savedConnection";
import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { classNames } from "@/shared/ui/classNames";

import styles from "./StatusBar.module.css";

export function StatusBar() {
  const { t, tCount } = useI18n();
  const appInfo = useAppInfo();
  const connection = useProjectStore((state) => state.project?.content.connection ?? null);
  const databaseName = useProjectStore(
    (state) => state.project?.content.snapshot.databaseName ?? null,
  );
  const tableCount = useProjectStore((state) => state.project?.content.snapshot.tables.length ?? 0);
  const viewCount = useProjectStore((state) => state.project?.content.snapshot.views.length ?? 0);
  const relationCount = useProjectStore(
    (state) => state.project?.content.snapshot.foreignKeys.length ?? 0,
  );

  return (
    <footer className={styles.statusBar}>
      <span className={styles.item}>
        <span
          className={classNames(styles.dot, connection !== null && styles.dotConnected)}
          aria-hidden="true"
        />
        {connection === null || databaseName === null
          ? t("statusBar.notConnected")
          : t("statusBar.connected", {
              target: describeSavedConnection(connection).target,
              database: databaseName,
            })}
      </span>
      <span className={styles.item}>{tCount("statusBar.tables", tableCount)}</span>
      {viewCount > 0 ? (
        <span className={styles.item}>{tCount("statusBar.views", viewCount)}</span>
      ) : null}
      <span className={styles.item}>{tCount("statusBar.relations", relationCount)}</span>
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
