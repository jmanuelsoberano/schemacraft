import { Logo } from "@/shared/brand/Logo";
import { DEVELOPER_NAME, REPOSITORY_URL } from "@/shared/brand/credits";
import { useI18n } from "@/shared/i18n/useI18n";
import { useAppInfo } from "@/shared/ipc/useAppInfo";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";

import styles from "./AboutDialog.module.css";
import { useAboutStore } from "./aboutStore";

/** Name, version, author and the open source work the application is built on. */
export function AboutDialog() {
  const { t } = useI18n();
  const isOpen = useAboutStore((state) => state.isOpen);
  const close = useAboutStore((state) => state.close);
  const appInfo = useAppInfo();

  const version =
    appInfo.status === "ready"
      ? t("about.version", { version: appInfo.info.version })
      : t("statusBar.versionUnavailable");

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      title={t("about.title")}
      closeLabel={t("connection.action.close")}
      width={480}
      footer={<Button onClick={close}>{t("review.action.close")}</Button>}
    >
      <div className={styles.about}>
        <Logo size={48} />
        <div className={styles.details}>
          <div className={styles.name}>{t("app.name")}</div>
          <div className={styles.version}>{version}</div>
          <p className={styles.tagline}>{t("app.tagline")}</p>
          <dl className={styles.facts}>
            <dt>{t("about.developer")}</dt>
            <dd>{DEVELOPER_NAME}</dd>
            <dt>{t("about.source")}</dt>
            <dd className={styles.mono}>{REPOSITORY_URL}</dd>
          </dl>
          <p className={styles.builtWith}>{t("about.builtWith")}</p>
        </div>
      </div>
    </Dialog>
  );
}
