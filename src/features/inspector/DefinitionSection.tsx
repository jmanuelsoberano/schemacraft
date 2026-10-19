import {
  CircleQuestionMark,
  Clock3,
  CodeXml,
  FileCode2,
  LockKeyhole,
  ShieldQuestionMark,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";

import type { DefinitionSectionView } from "@/features/schema/moduleDetailsView";
import { useI18n } from "@/shared/i18n/useI18n";

import { CodeViewer } from "./CodeViewer";
import styles from "./ModuleSections.module.css";

const STATE_ICONS: Record<DefinitionSectionView["state"], LucideIcon> = {
  readable: FileCode2,
  notChecked: Clock3,
  notVisible: ShieldQuestionMark,
  encrypted: LockKeyhole,
  clr: CodeXml,
  notRecorded: CircleQuestionMark,
  notRead: CircleQuestionMark,
};

/** A missing definition is explanatory text, never an empty editor. */
export function DefinitionSection({
  section,
  onShowAccessReport,
}: {
  section: DefinitionSectionView;
  onShowAccessReport: () => void;
}) {
  const { t } = useI18n();
  const headingId = useId();
  const Icon = STATE_ICONS[section.state];
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.title}>
        {section.title}
      </h4>
      {section.badges.length === 0 ? null : (
        <div className={styles.badges}>
          {section.badges.map((badge) => (
            <span key={badge.label} className={styles.badge} title={badge.hint}>
              {badge.label}
            </span>
          ))}
        </div>
      )}
      <p className={styles.state}>
        <Icon aria-hidden="true" className={styles.stateIcon} />
        {section.stateLabel}
      </p>
      {section.notice === null ? null : <p className={styles.notice}>{section.notice}</p>}
      {section.explanation === null ? null : (
        <p className={styles.note}>
          {section.explanation}
          {section.canExplainAccess ? (
            <>
              {" "}
              <button
                type="button"
                className={styles.link}
                aria-label={t("inspector.why.label")}
                onClick={onShowAccessReport}
              >
                {t("inspector.why")}
              </button>
            </>
          ) : null}
        </p>
      )}
      {section.text === null ? null : <CodeViewer text={section.text} />}
    </section>
  );
}
