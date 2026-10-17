import { ShieldHalf } from "lucide-react";

import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";

import styles from "./AccessBar.module.css";
import { CopyScriptButton } from "./CopyScriptButton";
import { describeAccessCause, grantHelps, primaryCause } from "./accessCause";
import { noticeSignature, showsAccessBar } from "./accessNotice";
import { grantScript } from "./grantScript";

interface AccessBarProps {
  /** Opens the Access report. */
  onShowDetails: () => void;
  /**
   * Called once the bar is closed and gone, so the caller can put focus somewhere defined
   * instead of leaving it on the vanished close button.
   */
  onDismissed: () => void;
}

/**
 * One polite notice at the top of the entities panel while the project was read with partial
 * access: the main cause, the report and, when it helps, the GRANT script. It never takes focus,
 * and closing it is remembered for this server, database and verdict.
 */
export function AccessBar({ onShowDetails, onDismissed }: AccessBarProps) {
  const translator = useI18n();
  const { t, locale } = translator;
  const connection = useProjectStore((state) => state.project?.content.connection ?? null);
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const dismissed = useSettingsStore((state) => state.dismissedAccessNotices);
  const dismissAccessNotice = useSettingsStore((state) => state.dismissAccessNotice);

  if (
    connection === null ||
    snapshot?.access === undefined ||
    !showsAccessBar(connection, snapshot, dismissed)
  ) {
    return null;
  }
  const { access } = snapshot;
  const signature = noticeSignature(connection, snapshot);
  const cause = primaryCause(access);

  return (
    <div className={styles.bar}>
      <Alert
        variant="warning"
        live="polite"
        icon={ShieldHalf}
        title={t("access.bar.title")}
        dismissLabel={t("access.bar.dismiss")}
        onDismiss={() => {
          if (signature !== null) {
            dismissAccessNotice(signature);
          }
          onDismissed();
        }}
        action={
          <>
            <Button onClick={onShowDetails}>{t("access.action.details")}</Button>
            {grantHelps(access) ? (
              <CopyScriptButton
                script={grantScript({
                  database: snapshot.databaseName,
                  principal: access.probe.databaseUser,
                  locale,
                })}
              />
            ) : null}
          </>
        }
      >
        {cause === null ? null : describeAccessCause(cause, translator)}
      </Alert>
    </div>
  );
}
