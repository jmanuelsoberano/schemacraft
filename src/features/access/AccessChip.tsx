import { ShieldHalf } from "lucide-react";

import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { Tooltip } from "@/shared/ui/Tooltip";

import styles from "./AccessChip.module.css";
import { describeAccessCause, primaryCause } from "./accessCause";
import { showsAccessChip } from "./accessNotice";

interface AccessChipProps {
  /** Opens the Access report, through the action registry. */
  onOpen: () => void;
  /** Formatted shortcut of the report, for the tooltip. */
  shortcutHint?: string;
}

/**
 * Quiet, permanent marker in the status bar while the open project was read with partial
 * access. It cannot be dismissed and disappears once a capture is complete; its tooltip names
 * the main cause and activating it opens the Access report.
 */
export function AccessChip({ onOpen, shortcutHint }: AccessChipProps) {
  const translator = useI18n();
  const { t } = translator;
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);

  if (snapshot?.access === undefined || !showsAccessChip(snapshot)) {
    return null;
  }
  const cause = primaryCause(snapshot.access);

  return (
    <Tooltip
      side="top"
      label={t("action.accessReport")}
      description={cause === null ? undefined : describeAccessCause(cause, translator)}
      shortcutHint={shortcutHint}
    >
      <button
        type="button"
        className={styles.chip}
        aria-label={t("access.chip.label")}
        onClick={onOpen}
      >
        <ShieldHalf className={styles.icon} aria-hidden="true" />
        {t("access.chip")}
      </button>
    </Tooltip>
  );
}
