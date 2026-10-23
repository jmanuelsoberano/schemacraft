import type { ComparisonCapture, SchemaSnapshot } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";

import { comparisonCaptureFields } from "./comparisonEvidence";
import styles from "./ComparisonDialog.module.css";

export function ComparisonCaptureDetails({
  snapshot,
  capture,
  isReadOnly,
}: {
  snapshot: SchemaSnapshot;
  capture: ComparisonCapture | undefined;
  isReadOnly: boolean;
}) {
  const translator = useI18n();
  const { t } = translator;
  return (
    <details>
      <summary>{t("comparison.capture.title")}</summary>
      <dl className={styles.captureFacts}>
        {comparisonCaptureFields(snapshot, capture, translator).map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      {capture?.hasUnknownExtensions || isReadOnly ? (
        <p>{t("comparison.capture.unknownExtensions")}</p>
      ) : null}
      {snapshot.provider === "postgreSql" ? <p>{t("module.native.reconstructed")}</p> : null}
      <p>{t("comparison.limitations")}</p>
    </details>
  );
}
