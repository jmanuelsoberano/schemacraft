import { useSchemaStore } from "@/features/schema/schemaStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { classNames } from "@/shared/ui/classNames";

import styles from "./StatusBar.module.css";

export function StatusBar() {
  const { t, tCount } = useI18n();
  const appInfo = useAppInfo();
  const source = useSchemaStore((state) => state.source);
  const tableCount = useSchemaStore((state) => state.snapshot?.tables.length ?? 0);
  const viewCount = useSchemaStore((state) => state.snapshot?.views.length ?? 0);
  const relationCount = useSchemaStore((state) => state.snapshot?.foreignKeys.length ?? 0);

  return (
    <footer className={styles.statusBar}>
      <span className={styles.item}>
        <span
          className={classNames(styles.dot, source !== null && styles.dotConnected)}
          aria-hidden="true"
        />
        {source === null
          ? t("statusBar.notConnected")
          : t("statusBar.connected", { target: source.target, database: source.database })}
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
