import { comparisonObjectLabel } from "@/features/comparison/comparisonModel";
import {
  comparisonPropertyLabel,
  comparisonValueLabel,
} from "@/features/comparison/comparisonPresentation";
import { dependencyObjectLabel } from "@/features/dependencies/dependencyGraph";
import type { RefreshMetadataDiff } from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { useI18n } from "@/shared/i18n/useI18n";

import styles from "./ReviewChangesPanel.module.css";
import { hasMetadataReview } from "./reviewMetadata";

/** Independent metadata outcomes never masquerade as table additions or lost module text. */
export function ReviewMetadataChanges({ metadata }: { metadata: RefreshMetadataDiff | undefined }) {
  const { t, tCount, locale } = useI18n();
  if (!metadata || !hasMetadataReview(metadata)) return null;
  const dependencies = metadata.dependencies;
  return (
    <>
      <section className={styles.section} aria-label={t("comparison.dependencies")}>
        <h3 className={styles.sectionTitle}>{t("comparison.dependencies")}</h3>
        {dependencies.newlyRecorded ? <p>{t("review.metadata.recorded")}</p> : null}
        {dependencies.excluded ? <p>{t("review.metadata.excluded")}</p> : null}
        {dependencies.scopeChanged ? <p>{t("review.metadata.scope")}</p> : null}
        {dependencies.captureChanged && !dependencies.newlyRecorded && !dependencies.excluded ? (
          <p>{t("review.metadata.capture")}</p>
        ) : null}
        {dependencies.newlyAvailableSources > 0 ? (
          <p>{t("review.metadata.available", { count: dependencies.newlyAvailableSources })}</p>
        ) : null}
        {dependencies.readFailure !== null ? (
          <p>{t(`dependencies.reason.${dependencies.readFailure}`)}</p>
        ) : null}
        <ul className={styles.list}>
          {dependencies.changes.map((change) => (
            <li key={JSON.stringify(change.object)} className={styles.item}>
              <strong>{dependencyObjectLabel(change.object)}</strong>
              <span>
                {tCount("review.summary.added", change.added)} ·{" "}
                {tCount("review.summary.removed", change.removed)}
              </span>
            </li>
          ))}
        </ul>
        <ul className={styles.list}>
          {dependencies.notChecked.map((source) => (
            <li key={JSON.stringify(source.object)}>
              <strong>{dependencyObjectLabel(source.object)}</strong> ·{" "}
              {t(source.retained ? "comparison.status.retained" : "comparison.status.notVisible")} ·{" "}
              {formatDate(source.readAt, locale)}
            </li>
          ))}
        </ul>
      </section>
      {metadata.nativeRecorded ? <p>{t("review.metadata.nativeRecorded")}</p> : null}
      {metadata.nativeChanges.length > 0 || metadata.nativeNotChecked.length > 0 ? (
        <section className={styles.section} aria-label={t("comparison.native")}>
          <h3 className={styles.sectionTitle}>{t("comparison.native")}</h3>
          <ul className={styles.list}>
            {[...metadata.nativeChanges, ...metadata.nativeNotChecked].map((change, index) => (
              <li key={`${JSON.stringify(change.object)}:${index}`}>
                <strong>{comparisonObjectLabel(change.object)}</strong>
                <ul>
                  {change.properties.map((property) => (
                    <li key={JSON.stringify(property.path)}>
                      {comparisonPropertyLabel(property.path, t)}:{" "}
                      <span>{comparisonValueLabel(property.reference, t, property.path)}</span> →{" "}
                      <span>{comparisonValueLabel(property.compared, t, property.path)}</span> ·{" "}
                      {t(`comparison.outcome.${property.result}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
