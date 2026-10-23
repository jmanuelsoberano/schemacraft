import type { Translator } from "@/shared/i18n/useI18n";
import { CopyButton } from "@/shared/ui/CopyButton";

import styles from "./ComparisonDialog.module.css";

/** Availability belongs to each side; missing text never conceals the other original. */
export function ComparisonSourcePane({
  side,
  text,
  t,
}: {
  side: "reference" | "compared";
  text: string | null;
  t: Translator["t"];
}) {
  const label = t(`comparison.${side}`);
  return (
    <section>
      {text === null ? (
        <>
          <strong>{label}</strong>
          <p>{t("comparison.sourceSideUnavailable")}</p>
        </>
      ) : (
        <>
          <label>
            {label}
            <textarea className={styles.original} readOnly spellCheck={false} value={text} />
          </label>
          <CopyButton
            text={text}
            label={`${t("codeViewer.copy")} · ${label}`}
            copiedLabel={t("copy.copied")}
            failedLabel={t("copy.failed")}
          />
        </>
      )}
    </section>
  );
}
