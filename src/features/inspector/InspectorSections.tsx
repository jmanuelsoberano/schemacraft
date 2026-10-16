import { CircleQuestionMark, Clock3, ShieldQuestionMark } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";

import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import type {
  BadgeView,
  ColumnsSectionView,
  ConstraintSectionView,
  RelationSectionView,
  RelationTargetView,
  SectionView,
  ValueState,
  ValueView,
} from "@/features/schema/objectDetailsView";
import { useI18n } from "@/shared/i18n/useI18n";
import { Tooltip } from "@/shared/ui/Tooltip";
import { classNames } from "@/shared/ui/classNames";

import styles from "./InspectorSections.module.css";

/*
 * The sections of the Inspector draw the DetailsView the viewer's detail panel draws, one
 * component per section kind, so the two renderers stay in step and a later part can replace
 * one item renderer without touching the rest. What the Inspector adds is a way out: a fact
 * the login could not see links to the Access report, which the exported file cannot offer.
 */

/** The badges with a colour of their own; the rest are plain. */
const BADGE_TONES: Partial<Record<BadgeView["kind"], string | undefined>> = {
  primaryKey: styles.badgeKey,
  foreignKey: styles.badgeLink,
};

/** The mark of a value the capture could not vouch for, by why it could not. */
const STATE_ICONS: Record<Exclude<ValueState, "readable">, LucideIcon> = {
  notAvailable: ShieldQuestionMark,
  notRecorded: CircleQuestionMark,
  notChecked: Clock3,
};

interface SectionProps {
  section: SectionView;
  /** Opens the Access report, the answer to every "Why?". */
  onShowAccessReport: () => void;
}

/**
 * A section with its title and count, its items or its one honest empty line, and a footnote.
 * The empty line and the footnote link to the report when the login's access is what the list
 * may be missing.
 */
export function InspectorSection({ section, onShowAccessReport }: SectionProps) {
  const headingId = useId();
  const explains = section.completeness === "notVisible";
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.title}>
        {section.title}
        {section.count > 0 ? <span className={styles.count}>{section.count}</span> : null}
      </h4>
      {section.emptyText === null ? (
        <SectionBody section={section} onShowAccessReport={onShowAccessReport} />
      ) : (
        <p className={styles.note}>
          {section.emptyText}
          {explains ? <WhyLink onShow={onShowAccessReport} /> : null}
        </p>
      )}
      {section.footnote === null ? null : (
        <p className={styles.note}>
          {section.footnote}
          {explains ? <WhyLink onShow={onShowAccessReport} /> : null}
        </p>
      )}
    </section>
  );
}

function SectionBody({ section, onShowAccessReport }: SectionProps) {
  switch (section.kind) {
    case "columns":
      return <ColumnsTable section={section} onShowAccessReport={onShowAccessReport} />;
    case "primaryKey":
    case "indexes":
    case "checks":
      return <ConstraintList section={section} onShowAccessReport={onShowAccessReport} />;
    case "references":
    case "referencedBy":
      return <RelationList section={section} onShowAccessReport={onShowAccessReport} />;
  }
}

interface ColumnsTableProps {
  section: ColumnsSectionView;
  onShowAccessReport: () => void;
}

/** Column, type and nullability per row; the badges follow the name and the default the type. */
function ColumnsTable({ section, onShowAccessReport }: ColumnsTableProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{section.headers.name}</th>
          <th scope="col">{section.headers.type}</th>
          <th scope="col">{section.headers.nullable}</th>
        </tr>
      </thead>
      <tbody>
        {section.items.map((column) => (
          <tr key={column.name}>
            <td className={styles.nameCell}>
              <span className={styles.mono}>{column.name}</span>
              {column.badges.map((badge) => (
                <Badge key={badge.kind} badge={badge} />
              ))}
            </td>
            <td className={styles.typeCell}>
              <span className={styles.mono}>{column.type}</span>
              {column.defaultValue === null ? null : (
                <div className={styles.subLine}>
                  <Value value={column.defaultValue} onShowAccessReport={onShowAccessReport} />
                </div>
              )}
            </td>
            <td className={styles.nullableCell}>{column.nullable}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ConstraintListProps {
  section: ConstraintSectionView;
  onShowAccessReport: () => void;
}

/** Primary key, indexes and `CHECK`s: the name with its columns and badges, then the expression. */
function ConstraintList({ section, onShowAccessReport }: ConstraintListProps) {
  return (
    <ul className={styles.list}>
      {section.items.map((item) => (
        <li key={item.name} className={styles.item}>
          <div className={styles.itemHead}>
            <span className={styles.mono}>
              {item.name}
              {item.columns.length === 0 ? null : (
                <span className={styles.secondary}> ({item.columns.join(", ")})</span>
              )}
            </span>
            {item.badges.map((badge) => (
              <Badge key={badge.kind} badge={badge} />
            ))}
          </div>
          {item.expression === null ? null : (
            <div className={styles.subLine}>
              <Value value={item.expression} onShowAccessReport={onShowAccessReport} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

interface RelationListProps {
  section: RelationSectionView;
  onShowAccessReport: () => void;
}

/**
 * Foreign keys out of or into the table: the name and badges, the column pairs, the actions
 * other than NO ACTION, the other table and, for a key kept from an earlier read, since when.
 */
function RelationList({ section, onShowAccessReport }: RelationListProps) {
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const openInspector = useCanvasUiStore((state) => state.openInspector);

  // Following a relation selects and centres the other table; the panel follows the selection
  // and takes focus again, so the keyboard stays where the reader is.
  const follow = (key: string) => {
    focusEntity(key);
    openInspector({ focus: true });
  };

  return (
    <ul className={styles.list}>
      {section.items.map((item) => (
        <li key={`${item.name}:${item.target.label}`} className={styles.item}>
          <div className={styles.itemHead}>
            <span className={styles.mono}>{item.name}</span>
            {item.badges.map((badge) => (
              <Badge key={badge.kind} badge={badge} />
            ))}
          </div>
          <div className={classNames(styles.mono, styles.secondary)}>{item.columns.join(", ")}</div>
          {item.actions.map((action) => (
            <div key={action} className={styles.secondary}>
              {action}
            </div>
          ))}
          <RelationTarget
            target={item.target}
            onFollow={follow}
            onShowAccessReport={onShowAccessReport}
          />
          {item.hint === null ? null : <div className={styles.hint}>{item.hint}</div>}
        </li>
      ))}
    </ul>
  );
}

interface RelationTargetProps {
  target: RelationTargetView;
  onFollow: (key: string) => void;
  onShowAccessReport: () => void;
}

/** The other table of a relation: a link when it is on the canvas, otherwise why it is not. */
function RelationTarget({ target, onFollow, onShowAccessReport }: RelationTargetProps) {
  const { key } = target;
  if (key !== null) {
    return (
      <button
        type="button"
        className={styles.link}
        aria-label={target.goLabel ?? undefined}
        onClick={() => {
          onFollow(key);
        }}
      >
        {target.label}
      </button>
    );
  }
  if (target.state === "notVisible") {
    return (
      <div className={styles.valueRow}>
        <span className={styles.state}>
          <ShieldQuestionMark className={styles.stateIcon} aria-hidden="true" />
          {target.label}
        </span>
        <WhyLink onShow={onShowAccessReport} />
      </div>
    );
  }
  return (
    <div>
      <span className={styles.mono}>{target.label}</span>
      {target.stateLabel === null ? null : (
        <span className={styles.secondary}> · {target.stateLabel}</span>
      )}
    </div>
  );
}

interface ValueProps {
  value: ValueView;
  onShowAccessReport: () => void;
}

/**
 * A `CHECK` or `DEFAULT` text. A text this capture read is plain. A missing or unchecked one is
 * marked, and its reason is one hover or one focus away: the "Why?" link carries it when the
 * report answers, the marked value itself otherwise.
 */
function Value({ value, onShowAccessReport }: ValueProps) {
  if (value.state === "readable") {
    return <span className={styles.mono}>{value.text}</span>;
  }
  const Icon = STATE_ICONS[value.state];
  const marked = (
    <>
      <Icon className={styles.stateIcon} aria-hidden="true" />
      <span className={styles.mono}>{value.text}</span>
    </>
  );
  if (value.state === "notAvailable") {
    return (
      <span className={styles.valueRow}>
        <span className={styles.state} title={value.hint ?? undefined}>
          {marked}
        </span>
        <WhyLink hint={value.hint} onShow={onShowAccessReport} />
      </span>
    );
  }
  return (
    <Tooltip label={value.hint ?? value.text}>
      <span className={styles.state} tabIndex={0}>
        {marked}
      </span>
    </Tooltip>
  );
}

interface WhyLinkProps {
  /** The reason the fact is missing, shown on hover and focus before the report is opened. */
  hint?: string | null;
  onShow: () => void;
}

/** The way from a fact the login could not see to the Access report that says why. */
function WhyLink({ hint, onShow }: WhyLinkProps) {
  const { t } = useI18n();
  const button = (
    <button
      type="button"
      className={styles.why}
      aria-label={t("inspector.why.label")}
      onClick={onShow}
    >
      {t("inspector.why")}
    </button>
  );
  return hint ? <Tooltip label={hint}>{button}</Tooltip> : button;
}

function Badge({ badge }: { badge: BadgeView }) {
  return <span className={classNames(styles.badge, BADGE_TONES[badge.kind])}>{badge.label}</span>;
}
