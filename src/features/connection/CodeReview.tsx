import { codeObjectName, groupCodeFacts } from "@/features/schema/codeFacts";
import type {
  AvailableCode,
  CaptureChange,
  CarriedCode,
  CodeChange,
  SchemaSnapshot,
} from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { useI18n } from "@/shared/i18n/useI18n";
import { classNames } from "@/shared/ui/classNames";
import styles from "./ReviewChangesPanel.module.css";

export function CodeChangeItem({ change }: { change: CodeChange }) {
  const { t } = useI18n();
  return (
    <li className={styles.item}>
      <span className={classNames(styles.badge, styles[change.kind])}>
        {t(`review.change.${change.kind}`)}
      </span>
      <span className={styles.name}>{codeObjectName(change.object) || t("code.kind.unknown")}</span>
      <span className={styles.meta}>
        {change.object.kind === "routine"
          ? t(
              change.routineKind === "procedure"
                ? "code.kind.procedure"
                : change.routineKind === "unknown" || change.routineKind === null
                  ? "code.kind.unknown"
                  : "code.kind.function",
            )
          : null}
      </span>
      {change.kind === "changed" ? (
        <ul className={styles.details}>
          {change.properties.map((property) => (
            <li key={property} className={styles.codeProperty}>
              {t(`review.code.property.${property}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Groups the non-change facts by kind, with a counted sentence and the original read date. */
export function CodeFactsSection({
  entries,
  snapshot,
  previous,
  mode,
}: {
  entries: readonly (CarriedCode | AvailableCode)[];
  snapshot: SchemaSnapshot;
  previous?: SchemaSnapshot;
  mode: "notChecked" | "nowAvailable";
}) {
  const { t, tCount, locale } = useI18n();
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t(`review.section.${mode}`)}</h3>
      {groupCodeFacts(entries, snapshot, previous).map((group) => (
        <div key={group.kind}>
          <h4 className={styles.factGroupTitle}>
            {tCount(`code.count.${group.kind}`, group.count)}
          </h4>
          <ul className={styles.list}>
            {group.entries.map((entry) => (
              <li key={JSON.stringify([entry.object, entry.part])} className={styles.factItem}>
                <span className={styles.name}>
                  {codeObjectName(entry.object) || t("code.kind.unknown")}
                </span>
                <span className={styles.meta}>
                  {"readAt" in entry
                    ? t("access.report.carried.entry", {
                        fact: t(`code.part.${entry.part}`),
                        date: formatDate(entry.readAt, locale),
                      })
                    : t(`code.part.${entry.part}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function CaptureChangeItem({ change }: { change: CaptureChange }) {
  const { t, tCount } = useI18n();
  switch (change.kind) {
    case "indexAndConstraintStateRecorded":
      return (
        <li className={styles.factItem}>
          <span className={styles.captureLabel}>{t("review.capture.indexAndConstraintState")}</span>
          <span className={styles.meta}>{tCount("review.capture.objects", change.count)}</span>
        </li>
      );
    case "moduleDefinitionsRecorded":
    case "moduleDefinitionsNoLongerRecorded":
      return (
        <li className={styles.factItem}>
          <span className={styles.captureLabel}>
            {tCount(`review.capture.${change.kind}`, change.count)}
          </span>
        </li>
      );
    case "programmabilityRecorded":
    case "programmabilityNoLongerRecorded": {
      const counts = [
        tCount("code.count.procedure", change.counts.procedures),
        tCount("code.count.function", change.counts.functions),
        tCount("code.count.trigger", change.counts.triggers),
        tCount("code.count.view", change.counts.views),
      ];
      return (
        <li className={styles.factItem}>
          <span className={styles.captureLabel}>{t(`review.capture.${change.kind}`)}</span>
          <span className={styles.meta}>{counts.join(" · ")}</span>
        </li>
      );
    }
  }
}
