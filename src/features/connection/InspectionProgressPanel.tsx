import { Check, Circle } from "lucide-react";

import { useI18n } from "@/shared/i18n/useI18n";
import { ProgressBar } from "@/shared/ui/ProgressBar";
import { Spinner } from "@/shared/ui/Spinner";
import { classNames } from "@/shared/ui/classNames";

import styles from "./InspectionProgressPanel.module.css";
import type { RunningInspection } from "./connectionStore";
import { displayedStages, stageStatus } from "./inspectionStages";

interface InspectionProgressPanelProps {
  inspection: RunningInspection;
}

export function InspectionProgressPanel({ inspection }: InspectionProgressPanelProps) {
  const { t, locale } = useI18n();
  const title = t("connection.progress.title", { database: inspection.database });

  return (
    <div className={styles.panel} aria-live="polite">
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{t("connection.progress.description")}</p>
      </div>
      <ProgressBar label={title} />
      <ul className={styles.stages}>
        {displayedStages(inspection.options).map((stage) => {
          const status = stageStatus(inspection.stages, stage);
          const count = inspection.stages[stage];
          return (
            <li
              key={stage}
              className={classNames(
                styles.stage,
                status === "done" && styles.stageDone,
                status === "active" && styles.stageActive,
              )}
            >
              <span className={styles.stageIcon}>
                {status === "done" ? (
                  <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                ) : status === "active" ? (
                  <Spinner size={14} />
                ) : (
                  <Circle size={8} aria-hidden="true" />
                )}
              </span>
              <span className={styles.stageLabel}>{t(`connection.stage.${stage}`)}</span>
              {typeof count === "number" ? (
                <span className={styles.stageCount}>{count.toLocaleString(locale)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {inspection.isCancelling ? (
        <p className={styles.description}>{t("connection.progress.cancelling")}</p>
      ) : null}
    </div>
  );
}
