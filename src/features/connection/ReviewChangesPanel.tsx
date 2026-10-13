import type { ReactNode } from "react";

import { describeColumn, formatDataType } from "@/features/schema/dataType";
import type {
  ChangeCounts,
  ChangeKind,
  CheckConstraint,
  CheckConstraintChange,
  Column,
  ColumnChange,
  ColumnProperty,
  ForeignKey,
  ForeignKeyChange,
  ForeignKeyProperty,
  Index,
  IndexChange,
  PrimaryKey,
  QualifiedName,
  SchemaDiff,
  TableChange,
  ViewChange,
} from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import type { Translator } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { classNames } from "@/shared/ui/classNames";

import styles from "./ReviewChangesPanel.module.css";
import { countChanges } from "./reviewChanges";

interface ReviewChangesPanelProps {
  diff: SchemaDiff;
}

const BADGE_CLASS: Record<ChangeKind, string | undefined> = {
  added: styles.added,
  removed: styles.removed,
  changed: styles.changed,
};

function qualified(name: QualifiedName): string {
  return `${name.schema}.${name.name}`;
}

function describePrimaryKey(key: PrimaryKey | null, t: Translator["t"]): string {
  return key === null ? t("review.value.none") : `${key.name} (${key.columns.join(", ")})`;
}

function describeIndex(index: Index, t: Translator["t"]): string {
  const kind = t(`indexKind.${index.kind}`);
  const clustered = index.isClustered ? `, ${t("indexKind.clustered")}` : "";
  return `${index.name} (${index.columns.join(", ")}) · ${kind}${clustered}`;
}

function describeCheckConstraint(constraint: CheckConstraint): string {
  return `${constraint.name} ${constraint.expression}`;
}

function describeForeignKey(key: ForeignKey): string {
  const pairs = key.columnPairs
    .map((pair) => `${pair.referencingColumn} → ${pair.referencedColumn}`)
    .join(", ");
  return `${qualified(key.referencingTable)} → ${qualified(key.referencedTable)} (${pairs})`;
}

function yesNo(value: boolean, t: Translator["t"]): string {
  return value ? t("review.value.yes") : t("review.value.no");
}

function columnPropertyValues(
  property: ColumnProperty,
  before: Column,
  after: Column,
  t: Translator["t"],
): [string, string] {
  switch (property) {
    case "dataType":
      return [formatDataType(before.dataType), formatDataType(after.dataType)];
    case "nullability":
      return [yesNo(before.isNullable, t), yesNo(after.isNullable, t)];
    case "defaultExpression":
      return [
        before.defaultExpression ?? t("review.value.none"),
        after.defaultExpression ?? t("review.value.none"),
      ];
    case "identity":
      return [yesNo(before.isIdentity, t), yesNo(after.isIdentity, t)];
    case "computed":
      return [yesNo(before.isComputed, t), yesNo(after.isComputed, t)];
  }
}

function foreignKeyPropertyValues(
  property: ForeignKeyProperty,
  before: ForeignKey,
  after: ForeignKey,
  t: Translator["t"],
): [string, string] {
  const pairs = (key: ForeignKey) =>
    key.columnPairs
      .map((pair) => `${pair.referencingColumn} → ${pair.referencedColumn}`)
      .join(", ");
  switch (property) {
    case "referencedTable":
      return [qualified(before.referencedTable), qualified(after.referencedTable)];
    case "columns":
      return [pairs(before), pairs(after)];
    case "onDelete":
      return [t(`referentialAction.${before.onDelete}`), t(`referentialAction.${after.onDelete}`)];
    case "onUpdate":
      return [t(`referentialAction.${before.onUpdate}`), t(`referentialAction.${after.onUpdate}`)];
    case "enabled":
      return [yesNo(before.isEnabled, t), yesNo(after.isEnabled, t)];
  }
}

function Badge({ kind }: { kind: ChangeKind }) {
  const { t } = useI18n();
  return (
    <span className={classNames(styles.badge, BADGE_CLASS[kind])}>
      {t(`review.change.${kind}`)}
    </span>
  );
}

function Transition({ before, after }: { before: string; after: string }) {
  return (
    <span className={styles.transition}>
      <span className={styles.before}>{before}</span>
      <span aria-hidden="true">→</span>
      <span className={styles.after}>{after}</span>
    </span>
  );
}

function Detail({
  kind,
  label,
  children,
}: {
  kind: ChangeKind;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className={styles.detail}>
      <Badge kind={kind} />
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{children}</span>
    </li>
  );
}

function ColumnDetails({ changes }: { changes: readonly ColumnChange[] }) {
  const { t } = useI18n();
  return (
    <>
      {changes.map((change) => {
        switch (change.kind) {
          case "added":
            return (
              <Detail key={change.column.name} kind="added" label={change.column.name}>
                {describeColumn(change.column)}
              </Detail>
            );
          case "removed":
            return (
              <Detail key={change.column.name} kind="removed" label={change.column.name}>
                {describeColumn(change.column)}
              </Detail>
            );
          case "changed":
            return (
              <Detail key={change.after.name} kind="changed" label={change.after.name}>
                {change.properties.map((property) => {
                  const [before, after] = columnPropertyValues(
                    property,
                    change.before,
                    change.after,
                    t,
                  );
                  return (
                    <span key={property} className={styles.property}>
                      <span className={styles.propertyName}>
                        {t(`review.property.${property}`)}
                      </span>
                      <Transition before={before} after={after} />
                    </span>
                  );
                })}
              </Detail>
            );
        }
      })}
    </>
  );
}

function IndexDetails({ changes }: { changes: readonly IndexChange[] }) {
  const { t } = useI18n();
  return (
    <>
      {changes.map((change) => {
        const index = change.kind === "changed" ? change.after : change.index;
        return (
          <Detail key={index.name} kind={change.kind} label={t("review.index")}>
            {change.kind === "changed" ? (
              <Transition
                before={describeIndex(change.before, t)}
                after={describeIndex(index, t)}
              />
            ) : (
              describeIndex(index, t)
            )}
          </Detail>
        );
      })}
    </>
  );
}

function CheckConstraintDetails({ changes }: { changes: readonly CheckConstraintChange[] }) {
  const { t } = useI18n();
  return (
    <>
      {changes.map((change) => {
        const constraint = change.kind === "changed" ? change.after : change.constraint;
        return (
          <Detail key={constraint.name} kind={change.kind} label={t("review.checkConstraint")}>
            {change.kind === "changed" ? (
              <Transition
                before={describeCheckConstraint(change.before)}
                after={describeCheckConstraint(constraint)}
              />
            ) : (
              describeCheckConstraint(constraint)
            )}
          </Detail>
        );
      })}
    </>
  );
}

function TableItem({ change }: { change: TableChange }) {
  const { t, tCount } = useI18n();
  if (change.kind !== "changed") {
    return (
      <li className={styles.item}>
        <Badge kind={change.kind} />
        <span className={styles.name}>{qualified(change.name)}</span>
        <span className={styles.meta}>{tCount("review.columns", change.columnCount)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{qualified(change.name)}</span>
      <span className={styles.meta} />
      <ul className={styles.details}>
        <ColumnDetails changes={change.columns} />
        {change.primaryKey ? (
          <Detail kind="changed" label={t("review.primaryKey")}>
            <Transition
              before={describePrimaryKey(change.primaryKey.before, t)}
              after={describePrimaryKey(change.primaryKey.after, t)}
            />
          </Detail>
        ) : null}
        <IndexDetails changes={change.indexes} />
        <CheckConstraintDetails changes={change.checkConstraints} />
      </ul>
    </li>
  );
}

function ViewItem({ change }: { change: ViewChange }) {
  const { tCount } = useI18n();
  if (change.kind !== "changed") {
    return (
      <li className={styles.item}>
        <Badge kind={change.kind} />
        <span className={styles.name}>{qualified(change.name)}</span>
        <span className={styles.meta}>{tCount("review.columns", change.columnCount)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{qualified(change.name)}</span>
      <span className={styles.meta} />
      <ul className={styles.details}>
        <ColumnDetails changes={change.columns} />
      </ul>
    </li>
  );
}

function ForeignKeyItem({ change }: { change: ForeignKeyChange }) {
  const { t } = useI18n();
  if (change.kind !== "changed") {
    return (
      <li className={styles.item}>
        <Badge kind={change.kind} />
        <span className={styles.name}>{change.key.name}</span>
        <span className={styles.meta}>{describeForeignKey(change.key)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{change.after.name}</span>
      <span className={styles.meta}>{describeForeignKey(change.after)}</span>
      <ul className={styles.details}>
        {change.properties.map((property) => {
          const [before, after] = foreignKeyPropertyValues(
            property,
            change.before,
            change.after,
            t,
          );
          return (
            <Detail key={property} kind="changed" label={t(`review.property.${property}`)}>
              <Transition before={before} after={after} />
            </Detail>
          );
        })}
      </ul>
    </li>
  );
}

function SummaryChip({ label, counts }: { label: string; counts: ChangeCounts }) {
  const { tCount } = useI18n();
  const parts = [
    counts.added > 0 ? tCount("review.summary.added", counts.added) : null,
    counts.removed > 0 ? tCount("review.summary.removed", counts.removed) : null,
    counts.changed > 0 ? tCount("review.summary.changed", counts.changed) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return null;
  }
  return (
    <span className={styles.chip}>
      <span className={styles.chipLabel}>{label}</span>
      {parts.join(" · ")}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

/** Lists what changed in the database since the project's snapshot, before it is applied. */
export function ReviewChangesPanel({ diff }: ReviewChangesPanelProps) {
  const { t } = useI18n();
  const { summary } = diff;

  if (countChanges(summary) === 0) {
    return (
      <Alert variant="success" title={t("review.empty.title")}>
        {t("review.empty.description")}
      </Alert>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.summary}>
        <SummaryChip label={t("review.section.tables")} counts={summary.tables} />
        <SummaryChip label={t("review.section.views")} counts={summary.views} />
        <SummaryChip label={t("review.section.foreignKeys")} counts={summary.foreignKeys} />
      </div>
      {diff.tables.length > 0 ? (
        <Section title={t("review.section.tables")}>
          {diff.tables.map((change) => (
            <TableItem key={qualified(change.name)} change={change} />
          ))}
        </Section>
      ) : null}
      {diff.views.length > 0 ? (
        <Section title={t("review.section.views")}>
          {diff.views.map((change) => (
            <ViewItem key={qualified(change.name)} change={change} />
          ))}
        </Section>
      ) : null}
      {diff.foreignKeys.length > 0 ? (
        <Section title={t("review.section.foreignKeys")}>
          {diff.foreignKeys.map((change) => {
            const key = change.kind === "changed" ? change.after : change.key;
            return (
              <ForeignKeyItem
                key={`${qualified(key.referencingTable)}.${key.name}`}
                change={change}
              />
            );
          })}
        </Section>
      ) : null}
    </div>
  );
}
