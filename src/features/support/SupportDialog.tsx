import { Download, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { useId } from "react";

import { describeOperationError } from "@/shared/errors/describeOperationError";
import { useI18n } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import { Spinner } from "@/shared/ui/Spinner";

import styles from "./SupportDialog.module.css";
import { useSupportStore } from "./supportStore";

/** A local preview and save, followed by an optional, separately opened public issue form. */
export function SupportDialog() {
  const translator = useI18n();
  const { t } = translator;
  const state = useSupportStore();
  const previewId = useId();
  const busy = state.isSaving || state.isOpeningPage;
  const failure = state.failure ? describeOperationError(state.failure, translator) : null;

  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={(open) => {
        if (!open) state.close();
      }}
      title={t("support.title")}
      description={t("support.description")}
      closeLabel={t("review.action.close")}
      isDismissable={!busy}
      width={720}
      footer={
        <Button onClick={state.close} disabled={busy}>
          {t("review.action.close")}
        </Button>
      }
    >
      <div className={styles.content}>
        <section className={styles.section} aria-label={t("support.diagnostic")}>
          <h3 className={styles.heading}>{t("support.diagnostic")}</h3>
          <p className={styles.hint}>{t("support.contents")}</p>
          <div className={styles.status} role="status" aria-live="polite">
            {state.isLoading ? (
              <>
                <Spinner />
                {t("support.loading")}
              </>
            ) : state.report ? (
              <>
                {t("support.logCount", { count: state.report.logCount })}
                {state.report.truncatedLogCount > 0 ? (
                  <span>{t("support.truncated", { count: state.report.truncatedLogCount })}</span>
                ) : null}
                {state.report.unavailableLogCount > 0 ? (
                  <span>
                    {t("support.unavailable", { count: state.report.unavailableLogCount })}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          {state.report?.logCount === 0 ? (
            <p className={styles.hint}>{t("support.noLogs")}</p>
          ) : null}
          <label className={styles.label} htmlFor={previewId}>
            {t("support.preview")}
          </label>
          <textarea
            id={previewId}
            className={styles.preview}
            value={state.report?.text ?? ""}
            readOnly
            spellCheck={false}
            aria-busy={state.isLoading}
          />
          <div className={styles.actions}>
            <Button
              leadingIcon={Download}
              disabled={state.report === null || state.isLoading || busy}
              onClick={() => {
                void state.saveReport(t("support.save"), t("support.fileType"));
              }}
            >
              {t(state.isSaving ? "support.saving" : "support.save")}
            </Button>
            <Button
              leadingIcon={RefreshCw}
              disabled={state.isLoading || busy}
              onClick={() => {
                void state.reload();
              }}
            >
              {t("support.reload")}
            </Button>
          </div>
          {state.savedPath ? (
            <div className={styles.saved} role="status">
              <span>{t("support.saved")}</span>
              <span className={styles.path}>{state.savedPath}</span>
              <Button
                leadingIcon={FolderOpen}
                disabled={busy}
                onClick={() => {
                  void state.revealSavedReport();
                }}
              >
                {t("support.reveal")}
              </Button>
            </div>
          ) : null}
        </section>
        <section className={styles.section} aria-label={t("support.report")}>
          <h3 className={styles.heading}>{t("support.report")}</h3>
          <p className={styles.hint}>{t("support.publicNotice")}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              leadingIcon={ExternalLink}
              disabled={busy}
              onClick={() => {
                void state.openPage("bugReport");
              }}
            >
              {t("support.openIssue")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void state.openPage("securityPolicy");
              }}
            >
              {t("support.security")}
            </Button>
          </div>
        </section>
        {failure ? (
          <Alert variant="danger" title={failure.title} detail={failure.detail}>
            {failure.hint}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
