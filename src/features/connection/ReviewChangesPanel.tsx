import { ListChecks, ShieldQuestionMark, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { describeSnapshotFact } from "@/features/access/snapshotFacts";
import { describeColumn, formatDataType } from "@/features/schema/dataType";
import type { DefaultLabels } from "@/features/schema/dataType";
import { definitionText, isUnknownDefinition } from "@/features/schema/definition";
import { entityKey } from "@/features/schema/entities";
import type {
  AvailableFact,
  CaptureChange,
  CarriedFact,
  ChangeCounts,
  ChangeKind,
  CheckConstraint,
  CheckConstraintChange,
  Column,
  ColumnChange,
  ColumnProperty,
  Definition,
  ForeignKey,
  ForeignKeyChange,
  ForeignKeyProperty,
  ForeignKeyToInvisibleTable,
  ForeignKeyToInvisibleTableChange,
  Index,
  IndexChange,
  PrimaryKey,
  SchemaDiff,
  SchemaSnapshot,
  TableChange,
  ViewChange,
} from "@/shared/contracts";
import { formatDate } from "@/shared/i18n/formatDate";
import { useI18n } from "@/shared/i18n/useI18n";
import type { Translator } from "@/shared/i18n/useI18n";
import { Alert } from "@/shared/ui/Alert";
import { classNames } from "@/shared/ui/classNames";

import styles from "./ReviewChangesPanel.module.css";
import { hasObjectChanges, isUpToDate } from "./reviewChanges";

interface ReviewChangesPanelProps {
  diff: SchemaDiff;
  /** The fresh snapshot the review compares against the project. */
  capture: SchemaSnapshot;
}

const BADGE_CLASS: Record<ChangeKind, string | undefined> = {
  added: styles.added,
  removed: styles.removed,
  changed: styles.changed,
};

/**
 * Names a primary key and its columns, and says when its index is disabled, so a change of that
 * state alone never reads as identical before and after.
 */
function describePrimaryKey(key: PrimaryKey | null, t: Translator["t"]): string {
  if (key === null) {
    return t("review.value.none");
  }
  const disabled = key.isEnabled === false ? ` · ${t("details.badge.disabled")}` : "";
  return `${key.name} (${key.columns.join(", ")})${disabled}`;
}

/**
 * Names an index, its key and included columns, its kind and the marks the Inspector gives it:
 * disabled and filtered. A state a project saved before 1.2 did not record is not mentioned.
 */
function describeIndex(index: Index, t: Translator["t"]): string {
  const marks = [
    t(`indexKind.${index.kind}`),
    index.isClustered ? t("indexKind.clustered") : null,
    index.isEnabled === false
      ? t(
          index.kind === "uniqueConstraint"
            ? "details.badge.disabled"
            : "details.badge.indexDisabled",
        )
      : null,
    index.isFiltered === true ? t("details.badge.filtered") : null,
  ].filter((mark): mark is string => mark !== null);
  const included = index.includedColumns ?? [];
  const include =
    included.length === 0 ? "" : ` ${t("details.include", { columns: included.join(", ") })}`;
  return `${index.name} (${index.columns.join(", ")})${include} · ${marks.join(", ")}`;
}

function describeDefinition(definition: Definition, t: Translator["t"]): string {
  return (
    definitionText(definition) ??
    t(isUnknownDefinition(definition) ? "definition.notRecorded" : "definition.notAvailable")
  );
}

/**
 * Names a CHECK and its expression, and says when it is disabled or not trusted, so a change of
 * either state alone never reads as identical before and after. A 1.0 project does not record
 * whether it is enabled (`isEnabled` is null), nor one saved before 1.2 whether it is trusted,
 * and then nothing is said about it.
 */
function describeCheckConstraint(constraint: CheckConstraint, t: Translator["t"]): string {
  const expression = describeDefinition(constraint.expression, t);
  if (constraint.isEnabled === false) {
    return t("review.checkConstraint.disabled", { name: constraint.name, expression });
  }
  return constraint.isEnabled === true && constraint.isTrusted === false
    ? t("review.checkConstraint.untrusted", { name: constraint.name, expression })
    : `${constraint.name} ${expression}`;
}

function describeForeignKey(key: ForeignKey): string {
  const pairs = key.columnPairs
    .map((pair) => `${pair.referencingColumn} → ${pair.referencedColumn}`)
    .join(", ");
  return `${entityKey(key.referencingTable)} → ${entityKey(key.referencedTable)} (${pairs})`;
}

function describeKeyToInvisibleTable(key: ForeignKeyToInvisibleTable, t: Translator["t"]): string {
  return t("review.foreignKey.invisibleTable", {
    table: entityKey(key.referencingTable),
    columns: key.columns.join(", "),
  });
}

function defaultLabels(t: Translator["t"]): DefaultLabels {
  return {
    notAvailable: t("definition.default.notAvailable"),
    notRecorded: t("definition.default.notRecorded"),
  };
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
    case "defaultExpression": {
      const describe = (column: Column) =>
        column.defaultExpression === null
          ? t("review.value.none")
          : describeDefinition(column.defaultExpression, t);
      return [describe(before), describe(after)];
    }
    case "identity":
      return [yesNo(before.isIdentity, t), yesNo(after.isIdentity, t)];
    case "computed":
      return [yesNo(before.isComputed, t), yesNo(after.isComputed, t)];
  }
}

function keyToInvisibleTablePropertyValues(
  property: ForeignKeyProperty,
  before: ForeignKeyToInvisibleTable,
  after: ForeignKeyToInvisibleTable,
  t: Translator["t"],
): [string, string] {
  switch (property) {
    // The referenced table of such a key is never known, so the diff never reports it.
    case "referencedTable":
      return [t("review.value.none"), t("review.value.none")];
    case "columns":
      return [before.columns.join(", "), after.columns.join(", ")];
    case "onDelete":
      return [t(`referentialAction.${before.onDelete}`), t(`referentialAction.${after.onDelete}`)];
    case "onUpdate":
      return [t(`referentialAction.${before.onUpdate}`), t(`referentialAction.${after.onUpdate}`)];
    case "enabled":
      return [yesNo(before.isEnabled, t), yesNo(after.isEnabled, t)];
    // Reported only when both sides recorded it.
    case "trust":
      return [yesNo(before.isTrusted === true, t), yesNo(after.isTrusted === true, t)];
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
      return [entityKey(before.referencedTable), entityKey(after.referencedTable)];
    case "columns":
      return [pairs(before), pairs(after)];
    case "onDelete":
      return [t(`referentialAction.${before.onDelete}`), t(`referentialAction.${after.onDelete}`)];
    case "onUpdate":
      return [t(`referentialAction.${before.onUpdate}`), t(`referentialAction.${after.onUpdate}`)];
    case "enabled":
      return [yesNo(before.isEnabled, t), yesNo(after.isEnabled, t)];
    // Reported only when both sides recorded it.
    case "trust":
      return [yesNo(before.isTrusted === true, t), yesNo(after.isTrusted === true, t)];
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
                {describeColumn(change.column, defaultLabels(t))}
              </Detail>
            );
          case "removed":
            return (
              <Detail key={change.column.name} kind="removed" label={change.column.name}>
                {describeColumn(change.column, defaultLabels(t))}
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
                before={describeCheckConstraint(change.before, t)}
                after={describeCheckConstraint(constraint, t)}
              />
            ) : (
              describeCheckConstraint(constraint, t)
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
        <span className={styles.name}>{entityKey(change.name)}</span>
        <span className={styles.meta}>{tCount("review.columns", change.columnCount)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{entityKey(change.name)}</span>
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
        <span className={styles.name}>{entityKey(change.name)}</span>
        <span className={styles.meta}>{tCount("review.columns", change.columnCount)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{entityKey(change.name)}</span>
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

function KeyToInvisibleTableItem({ change }: { change: ForeignKeyToInvisibleTableChange }) {
  const { t } = useI18n();
  if (change.kind !== "changed") {
    return (
      <li className={styles.item}>
        <Badge kind={change.kind} />
        <span className={styles.name}>{change.key.name}</span>
        <span className={styles.meta}>{describeKeyToInvisibleTable(change.key, t)}</span>
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <Badge kind="changed" />
      <span className={styles.name}>{change.after.name}</span>
      <span className={styles.meta}>{describeKeyToInvisibleTable(change.after, t)}</span>
      <ul className={styles.details}>
        {change.properties.map((property) => {
          const [before, after] = keyToInvisibleTablePropertyValues(
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

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  /** Marks a section that lists no change, so its meaning never rests on colour alone. */
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {Icon ? <Icon className={styles.sectionIcon} aria-hidden="true" /> : null}
        {title}
      </h3>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

/** Facts the fresh read could not check, kept with their saved value and when they were read. */
function NotCheckedSection({ facts }: { facts: readonly CarriedFact[] }) {
  const { t, locale } = useI18n();
  return (
    <Section title={t("review.section.notChecked")} icon={ShieldQuestionMark}>
      {facts.map((entry) => (
        <li key={JSON.stringify([entry.object, entry.fact])} className={styles.factItem}>
          <span className={styles.name}>{entityKey(entry.object)}</span>
          <span className={styles.meta}>
            {t("access.report.carried.entry", {
              fact: describeSnapshotFact(entry.fact, t),
              date: formatDate(entry.readAt, locale),
            })}
          </span>
        </li>
      ))}
    </Section>
  );
}

/** Facts the project could not state and this read can: applied, but not changes. */
function NowAvailableSection({ facts }: { facts: readonly AvailableFact[] }) {
  const { t } = useI18n();
  return (
    <Section title={t("review.section.nowAvailable")} icon={Sparkles}>
      {facts.map((entry) => (
        <li key={JSON.stringify([entry.object, entry.fact])} className={styles.factItem}>
          <span className={styles.name}>{entityKey(entry.object)}</span>
          <span className={styles.meta}>{describeSnapshotFact(entry.fact, t)}</span>
        </li>
      ))}
    </Section>
  );
}

/**
 * Families of facts this read records for the first time, one counted line each, such as the
 * state of every index and constraint of a project saved before 1.2. Applied, but not changes.
 */
function CaptureRecordedSection({ changes }: { changes: readonly CaptureChange[] }) {
  const { t, tCount } = useI18n();
  return (
    <Section title={t("review.section.captureRecorded")} icon={ListChecks}>
      {changes.map((change) => (
        <li key={change.kind} className={styles.factItem}>
          <span className={styles.captureLabel}>{t("review.capture.indexAndConstraintState")}</span>
          <span className={styles.meta}>{tCount("review.capture.objects", change.count)}</span>
        </li>
      ))}
    </Section>
  );
}

/** What a review without any schema change still brings to the project. */
function noChangeDescription(diff: SchemaDiff, t: Translator["t"]): string {
  if (diff.nowAvailable.length > 0) {
    return t("review.noChanges.nowAvailable");
  }
  if (diff.notChecked.length > 0) {
    return t("review.noChanges.notChecked");
  }
  if (diff.captureChanges.length > 0) {
    return t("review.noChanges.captureRecorded");
  }
  return t("review.noChanges.accessChanged");
}

/**
 * Lists what changed in the database since the project's snapshot, before it is applied, and
 * what the fresh read could not check or can now read. Nothing the login could not see is
 * reported as removed, and a partial read never claims that the project is up to date.
 */
export function ReviewChangesPanel({ diff, capture }: ReviewChangesPanelProps) {
  const { t, tCount } = useI18n();
  const { summary } = diff;
  const isPartialCapture = capture.access?.level === "partial";
  const hasChanges = hasObjectChanges(diff);

  if (isUpToDate(diff)) {
    return isPartialCapture ? (
      <Alert variant="success" title={t("review.empty.partial.title")}>
        {t("review.empty.partial.description")}
      </Alert>
    ) : (
      <Alert variant="success" title={t("review.empty.title")}>
        {t("review.empty.description")}
      </Alert>
    );
  }

  return (
    <div className={styles.panel}>
      {diff.notChecked.length > 0 ? (
        <Alert variant="info" icon={ShieldQuestionMark} title={t("review.notChecked.title")}>
          {tCount("review.notChecked.body", diff.notChecked.length)}
        </Alert>
      ) : null}
      {hasChanges ? (
        <div className={styles.summary}>
          <SummaryChip label={t("review.section.tables")} counts={summary.tables} />
          <SummaryChip label={t("review.section.views")} counts={summary.views} />
          <SummaryChip label={t("review.section.foreignKeys")} counts={summary.foreignKeys} />
        </div>
      ) : (
        <Alert
          variant="success"
          title={isPartialCapture ? t("review.empty.partial.title") : t("review.noChanges.title")}
        >
          {noChangeDescription(diff, t)}
        </Alert>
      )}
      {diff.tables.length > 0 ? (
        <Section title={t("review.section.tables")}>
          {diff.tables.map((change) => (
            <TableItem key={entityKey(change.name)} change={change} />
          ))}
        </Section>
      ) : null}
      {diff.views.length > 0 ? (
        <Section title={t("review.section.views")}>
          {diff.views.map((change) => (
            <ViewItem key={entityKey(change.name)} change={change} />
          ))}
        </Section>
      ) : null}
      {diff.foreignKeys.length > 0 || diff.foreignKeysToInvisibleTables.length > 0 ? (
        <Section title={t("review.section.foreignKeys")}>
          {diff.foreignKeys.map((change) => {
            const key = change.kind === "changed" ? change.after : change.key;
            return (
              <ForeignKeyItem
                key={`${entityKey(key.referencingTable)}.${key.name}`}
                change={change}
              />
            );
          })}
          {diff.foreignKeysToInvisibleTables.map((change) => {
            const key = change.kind === "changed" ? change.after : change.key;
            return (
              <KeyToInvisibleTableItem
                key={`invisible:${entityKey(key.referencingTable)}.${key.name}`}
                change={change}
              />
            );
          })}
        </Section>
      ) : null}
      {diff.nowAvailable.length > 0 ? <NowAvailableSection facts={diff.nowAvailable} /> : null}
      {diff.captureChanges.length > 0 ? (
        <CaptureRecordedSection changes={diff.captureChanges} />
      ) : null}
      {diff.notChecked.length > 0 ? <NotCheckedSection facts={diff.notChecked} /> : null}
      {diff.accessChanged && hasChanges ? (
        <p className={styles.note}>{t("review.accessChanged")}</p>
      ) : null}
    </div>
  );
}
