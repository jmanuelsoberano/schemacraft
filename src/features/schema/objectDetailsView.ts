import { formatDate } from "@/shared/i18n/formatDate";
import type { PostgresqlConstraint } from "@/shared/contracts";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import type { EntityKind } from "./entities";
import { definitionText } from "./definition";
import { qualifiedNameLabel } from "./entities";
import type {
  CheckFacts,
  ColumnFacts,
  DetailSection,
  DetailSectionKind,
  FactText,
  IndexFacts,
  KeyFacts,
  ListCompleteness,
  ObjectDetails,
  RelationFacts,
  RelationTarget,
  TriggerFacts,
} from "./objectDetails";
import type { ModuleRef } from "./modules";
import {
  presentTriggerBadges,
  presentTriggerEvents,
  triggerListNotes,
  triggerRunNotes,
} from "./triggerDetailsView";
import type { TriggerEventView } from "./triggerDetailsView";
import type { RuleNote } from "./rules/checkReader";
import { formatRuleText } from "./rules/ruleText";
import type { RuleGroup, RuleNode, RulePart } from "./rules/ruleText";

/**
 * The object details as text: every title, badge, value and empty line translated, and every
 * `CHECK` and key put into words, so the Inspector and the viewer's detail panel draw the same
 * words from the same facts. Nothing here knows the DOM, React or a store; the renderers only
 * lay the text out.
 */

/**
 * The words the details are said in: the `details.*` strings, the entity words, the names of
 * index kinds and definition states, and the readable rules. The application's translator
 * narrows to it, and so does the viewer's over the subset embedded in an HTML file.
 */
export type DetailsMessageKey = Extract<
  MessageKey,
  | `details.${string}`
  | `entity.${string}`
  | `indexKind.${string}`
  | `definition.${string}`
  | `rule.${string}`
  | `trigger.${string}`
>;

export type DetailsTranslator = CatalogTranslator<DetailsMessageKey>;

/** How far the capture vouches for a value, for a renderer that marks or explains it. */
export type ValueState = FactText["status"];

/** A `CHECK` or `DEFAULT` text, or the words for its missing text, with why it is missing. */
export interface ValueView {
  state: ValueState;
  text: string;
  /** Why the text is missing or may be stale; `null` for a value this capture read. */
  hint: string | null;
}

/**
 * The marks of a column, key, index or constraint. `disabled`, `filtered` and `untrusted` say what
 * SQL Server does not enforce: a disabled index or constraint enforces nothing, a filtered index
 * only the rows of its filter, and SQL Server marks an untrusted constraint as not trusted, so the
 * rows already there may not follow it. They take the neutral tone of every badge but the key and
 * link ones.
 */
export type BadgeKind =
  | "primaryKey"
  | "foreignKey"
  | "identity"
  | "computed"
  | "unique"
  | "clustered"
  | "disabled"
  | "filtered"
  | "untrusted";

export interface BadgeView {
  kind: BadgeKind;
  label: string;
}

/**
 * A sentence of a rule, or a group of them under a heading such as "When Discount has a
 * value:", in parts a renderer draws as text, column and table chips, and code.
 */
export type RuleNodeView =
  | { kind: "sentence"; parts: readonly RulePart[] }
  | {
      kind: "group";
      group: RuleGroup["kind"];
      heading: readonly RulePart[];
      items: readonly RuleNodeView[];
    };

/** What a rule involves on the diagram, highlighted while the reader points at the rule. */
export interface RuleTargets {
  /** Column names by entity key; a self-reference lists both ends under its one table. */
  columns: ReadonlyMap<string, readonly string[]>;
  /** Id of the relationship drawn for a key; `null` for a `CHECK` or a key no diagram draws. */
  relation: string | null;
}

/** Whether pointing at a rule highlights anything: a column, or a relationship to emphasise. */
export function hasRuleTargets(targets: RuleTargets): boolean {
  return (
    targets.relation !== null || [...targets.columns.values()].some((names) => names.length > 0)
  );
}

/** A `CHECK` constraint or a foreign key in words, with its SQL one click away. */
export interface RuleView {
  /**
   * The sentences in order; for a rule that cannot be put into words, only what is still known
   * in words, such as that the rows already there may not follow it, and often none.
   */
  sentences: readonly RuleNodeView[];
  /** Says the rule cannot be put into words, before its SQL; `null` when it is in words. */
  unread: string | null;
  /** The rule as SQL; `null` when it is unknown, as for a key to a table the login cannot see. */
  sql: string | null;
  /** Where the SQL comes from when it is not the stored text; `null` otherwise. */
  sqlNote: string | null;
  targets: RuleTargets;
}

export interface ColumnItemView {
  nativeNotes?: readonly string[];
  name: string;
  /** SQL declaration of the type, e.g. `nvarchar(120)`. */
  type: string;
  isNullable: boolean;
  /** "Yes" or "No", for the nullability cell. */
  nullable: string;
  badges: readonly BadgeView[];
  /** The default, or `null` when the column has none. */
  defaultValue: ValueView | null;
}

/** A primary key, an index or a `CHECK` constraint. */
export interface ConstraintItemView {
  nativeNotes?: readonly string[];
  name: string;
  /** Key columns in key order; empty for a `CHECK`. */
  columns: readonly string[];
  badges: readonly BadgeView[];
  /**
   * The included columns of an index as the SQL line `INCLUDE (…)`; `null` when it has none or
   * the file did not record them, and for keys and `CHECK`s.
   */
  include: string | null;
  /**
   * The `CHECK` text, or the words for its missing text with why it is missing; `null` for keys
   * and indexes. A renderer shows it when there is no {@link rule}; otherwise its hint, or, for a
   * text that is missing, its words for the missing text under the rule's sentences.
   */
  expression: ValueView | null;
  /**
   * The `CHECK` in words or as SQL; `null` for keys, indexes and a `CHECK` without its text,
   * which has a rule only when something about it is still known in words.
   */
  rule: RuleView | null;
}

export type RelationTargetState = RelationTarget["status"];

/** The table at the other end of a relation, as a link when it can be opened. */
export interface RelationTargetView {
  state: RelationTargetState;
  /** The table's `schema.name`, or the words for a table the login cannot see. */
  label: string;
  /** Why the table cannot be opened, e.g. "Hidden on the canvas"; `null` when it can. */
  stateLabel: string | null;
  /** Key of the entity to select, only when it is available on the canvas. */
  key: string | null;
  /** Accessible name of the link, e.g. "Go to sales.Orders"; `null` without a key. */
  goLabel: string | null;
}

export interface RelationItemView {
  nativeNotes?: readonly string[];
  name: string;
  /** "Child → Parent" column pairs in key order; the child column alone when the parent side is unknown. */
  columns: readonly string[];
  badges: readonly BadgeView[];
  target: RelationTargetView;
  /** Why the key may be stale; `null` when this capture read it. */
  hint: string | null;
  /** The key in words, its actions included, with its scripted SQL. */
  rule: RuleView;
}

interface SectionViewBase<Kind extends DetailSectionKind> {
  kind: Kind;
  title: string;
  count: number;
  /** Why the list may be missing something, for a renderer that can explain or link to it. */
  completeness: ListCompleteness["status"];
  /** The one muted line of an empty section; `null` when the section has items. */
  emptyText: string | null;
  /** What a section with items may still be missing; `null` otherwise. */
  footnote: string | null;
  /**
   * What the rules of the section need said once under them: how a pattern reads, that text
   * follows the collation, and that the words are derived from the definitions. Empty for a
   * section without rules in words.
   */
  notes: readonly string[];
}

export interface ColumnsSectionView extends SectionViewBase<"columns"> {
  headers: { name: string; type: string; nullable: string };
  items: readonly ColumnItemView[];
}

export type ConstraintSectionKind = "primaryKey" | "indexes" | "checks" | "nativeConstraints";

export interface ConstraintSectionView<
  Kind extends ConstraintSectionKind = ConstraintSectionKind,
> extends SectionViewBase<Kind> {
  items: readonly ConstraintItemView[];
}

export type RelationSectionKind = "references" | "referencedBy";

export interface RelationSectionView<
  Kind extends RelationSectionKind = RelationSectionKind,
> extends SectionViewBase<Kind> {
  items: readonly RelationItemView[];
}

export interface TriggerItemView {
  nativeNotes?: readonly string[];
  name: string;
  ref: Extract<ModuleRef, { kind: "trigger" }>;
  events: readonly TriggerEventView[];
  badges: readonly string[];
  hint: string | null;
  openLabel: string;
}

export interface TriggersSectionView extends SectionViewBase<"triggers"> {
  items: readonly TriggerItemView[];
}

/** Shared section metadata only; the desktop renderer separately resolves its saved SQL. */
export interface ViewDefinitionSectionView extends SectionViewBase<"viewDefinition"> {
  included: boolean;
  stateLabel: string | null;
  explanation: string | null;
  badges: readonly { label: string; hint: string }[];
}

/** One member per section kind, so a renderer can pick a section by its `kind` alone. */
export type SectionView =
  | ColumnsSectionView
  | ConstraintSectionView<"primaryKey">
  | ConstraintSectionView<"indexes">
  | ConstraintSectionView<"checks">
  | ConstraintSectionView<"nativeConstraints">
  | TriggersSectionView
  | RelationSectionView<"references">
  | RelationSectionView<"referencedBy">
  | ViewDefinitionSectionView;

export interface DetailsView {
  key: string;
  kind: EntityKind;
  /** "Table" or "View". */
  kindLabel: string;
  schema: string;
  name: string;
  /** "{count} columns". */
  summary: string;
  /** Says the whole object was kept from an earlier read; `null` when this capture read it. */
  notice: string | null;
  /** Every section that applies to the kind, in the facts' fixed order, empty ones included. */
  sections: readonly SectionView[];
}

/** The translator's pieces the builders below use, taken once per presentation. */
interface Words {
  t: DetailsTranslator["t"];
  /** A read moment as a local date, e.g. "12 Oct 2026". */
  date: (readAt: string) => string;
  /** The whole translator, which words the rules through their templates. */
  translator: DetailsTranslator;
}

function badge(kind: BadgeKind, label: string): BadgeView {
  return { kind, label };
}

/** A reader's sentences and groups, each worded in the translator's language. */
function ruleNodes(nodes: readonly RuleNode[], translator: DetailsTranslator): RuleNodeView[] {
  return nodes.map((node) =>
    node.kind === "sentence"
      ? { kind: "sentence", parts: formatRuleText(node.text, translator) }
      : {
          kind: "group",
          group: node.group.kind,
          heading: formatRuleText(node.heading, translator),
          items: ruleNodes(node.items, translator),
        },
  );
}

/**
 * A `CHECK` of the entity `entity` in words, or its stored SQL under the line that says it
 * cannot be put into words. When its text is missing, which the expression says, it is what is
 * still known in words, such as that the rows already there may not follow it, or `null` when
 * nothing is.
 */
function checkRule(constraint: CheckFacts, entity: string, words: Words): RuleView | null {
  if (constraint.native !== undefined) return nativeRule(constraint.native.definition, words);
  const { reading } = constraint;
  if (reading.status === "notAvailable" || reading.status === "notRecorded") {
    // The expression says the text is missing; what is still known in words is said above it.
    return reading.rules.length === 0
      ? null
      : {
          sentences: ruleNodes(reading.rules, words.translator),
          unread: null,
          sql: null,
          sqlNote: null,
          targets: { columns: new Map(), relation: null },
        };
  }
  const targets: RuleTargets = {
    columns: new Map(reading.columns.length === 0 ? [] : [[entity, reading.columns]]),
    relation: null,
  };
  // An unread rule still says when the rows already in the table may not follow it.
  return {
    sentences: ruleNodes(reading.rules, words.translator),
    unread: reading.status === "read" ? null : words.t("rule.check.unread"),
    sql: reading.sql,
    sqlNote: null,
    targets,
  };
}

/** A key in words, with its SQL scripted from the catalog when both of its tables are known. */
function relationRule(relation: RelationFacts, words: Words): RuleView {
  const { explanation } = relation;
  return {
    sentences: ruleNodes(explanation.rules, words.translator),
    unread: explanation.native === true ? words.t("details.native.ruleFallback") : null,
    sql: explanation.sql,
    sqlNote:
      explanation.sql === null
        ? null
        : words.t(explanation.native === true ? "details.native.reconstructed" : "rule.fk.sqlNote"),
    targets: { columns: explanation.columns, relation: relation.relation },
  };
}

/** The notes in the order a section shows them; one derived note applies to every rule in words. */
type SectionNote = RuleNote | "derived" | "derivedRecorded";

const SECTION_NOTES: readonly SectionNote[] = [
  "pattern",
  "collation",
  "derived",
  "derivedRecorded",
];

/**
 * The derived note for the rules in words. It keeps the 1.1 clause that rows saved before a rule
 * existed may not follow it while the file has not recorded whether SQL Server trusts one of
 * them. Once trust is recorded the clause goes: SQL Server verified a trusted rule against every
 * row, and an untrusted one says so itself, without a cause.
 */
function derivedNote(trust: readonly (boolean | null)[]): SectionNote {
  return trust.includes(null) ? "derived" : "derivedRecorded";
}

/**
 * The notes under a section: for `CHECK`s, those their readings need and the derived note when
 * any is in words; for keys, which are always in words, the derived note. Which derived note
 * depends on whether the trust of the section's rules in words is recorded.
 */
function sectionNotes(section: DetailSection, { t }: Words): string[] {
  const needed = new Set<SectionNote>();
  if (section.kind === "checks") {
    const trust: (boolean | null)[] = [];
    for (const { reading, isTrusted } of section.items) {
      if (reading.status === "read") {
        trust.push(isTrusted);
        for (const note of reading.notes) {
          needed.add(note);
        }
      }
    }
    if (trust.length > 0) {
      needed.add(derivedNote(trust));
    }
  } else if (
    (section.kind === "references" || section.kind === "referencedBy") &&
    section.items.some((item) => item.explanation.native !== true)
  ) {
    needed.add(derivedNote(section.items.map((item) => item.isTrusted)));
  }
  return SECTION_NOTES.filter((note) => needed.has(note)).map((note) => t(`rule.note.${note}`));
}

/** The `DEFAULT` of a column: its text, or the words that say why it is missing. */
function defaultView(value: FactText, { t, date }: Words): ValueView {
  switch (value.status) {
    case "readable":
      return {
        state: "readable",
        text: t("details.default", { expression: value.text }),
        hint: null,
      };
    case "notChecked":
      return {
        state: "notChecked",
        text: t("details.default", { expression: value.text }),
        hint: t("details.hint.notChecked", { date: date(value.readAt) }),
      };
    case "notAvailable":
      return {
        state: "notAvailable",
        text: t("definition.default.notAvailable"),
        hint: t("details.hint.notAvailable"),
      };
    case "notRecorded":
      return {
        state: "notRecorded",
        text: t("definition.default.notRecorded"),
        hint: t("details.hint.notRecorded"),
      };
  }
}

/** A `CHECK` expression: its text, or the words that say why it is missing. */
function expressionView(value: FactText, { t, date }: Words): ValueView {
  switch (value.status) {
    case "readable":
      return { state: "readable", text: value.text, hint: null };
    case "notChecked":
      return {
        state: "notChecked",
        text: value.text,
        hint: t("details.hint.notChecked", { date: date(value.readAt) }),
      };
    case "notAvailable":
      return {
        state: "notAvailable",
        text: t("definition.notAvailable"),
        hint: t("details.hint.notAvailable"),
      };
    case "notRecorded":
      return {
        state: "notRecorded",
        text: t("definition.notRecorded"),
        hint: t("details.hint.notRecorded"),
      };
  }
}

function columnItem(column: ColumnFacts, words: Words): ColumnItemView {
  const { t } = words;
  const badges: BadgeView[] = [];
  if (column.isPrimaryKey) {
    badges.push(badge("primaryKey", t("details.badge.primaryKey")));
  }
  if (column.isForeignKey) {
    badges.push(badge("foreignKey", t("details.badge.foreignKey")));
  }
  if (column.isIdentity) {
    badges.push(
      badge(
        "identity",
        column.native?.identityGeneration === "always" ||
          column.native?.identityGeneration === "byDefault"
          ? t(`details.native.identity.${column.native.identityGeneration}`)
          : t("details.badge.identity"),
      ),
    );
  }
  if (column.isComputed) {
    badges.push(
      badge(
        "computed",
        column.native?.generation === "stored" || column.native?.generation === "virtual"
          ? t(`details.native.generation.${column.native.generation}`)
          : t("details.badge.computed"),
      ),
    );
  }
  return {
    ...(column.native === undefined
      ? {}
      : {
          nativeNotes: [
            t("details.native.type", {
              kind: column.native.typeKind,
              name: qualifiedNameLabel(column.native.typeName),
            }),
            ...(column.native.generationExpression === null ||
            definitionText(column.native.generationExpression) === null
              ? []
              : [
                  t("details.native.generation", {
                    expression: definitionText(column.native.generationExpression) ?? "",
                  }),
                ]),
          ],
        }),
    name: column.name,
    type: column.type,
    isNullable: column.isNullable,
    nullable: t(column.isNullable ? "details.value.yes" : "details.value.no"),
    badges,
    defaultValue: column.defaultValue === null ? null : defaultView(column.defaultValue, words),
  };
}

function keyItem(key: KeyFacts, words: Words): ConstraintItemView {
  const { t } = words;
  const badges: BadgeView[] = [];
  if (key.isClustered) {
    badges.push(badge("clustered", t("indexKind.clustered")));
  }
  if (key.isEnabled === false) {
    badges.push(badge("disabled", t("details.badge.disabled")));
  }
  return {
    name: key.name,
    columns: key.columns,
    badges,
    include: null,
    expression: null,
    rule: key.native === undefined ? null : nativeRule(key.native.definition, words),
    ...(key.native === undefined ? {} : { nativeNotes: constraintNotes(key.native, words) }),
  };
}

function indexItem(index: IndexFacts, words: Words): ConstraintItemView {
  const { t } = words;
  const badges: BadgeView[] = [];
  if (index.kind !== "nonUnique") {
    badges.push(badge("unique", t(`indexKind.${index.kind}`)));
  }
  if (index.isClustered) {
    badges.push(badge("clustered", t("indexKind.clustered")));
  }
  if (index.isEnabled === false) {
    // A unique constraint is a constraint; the other kinds are indexes, whose word some
    // languages give another gender.
    badges.push(
      badge(
        "disabled",
        t(
          index.kind === "uniqueConstraint"
            ? "details.badge.disabled"
            : "details.badge.indexDisabled",
        ),
      ),
    );
  }
  if (index.isFiltered === true) {
    badges.push(badge("filtered", t("details.badge.filtered")));
  }
  const included = index.includedColumns ?? [];
  return {
    name: index.name,
    columns: index.native?.keyTerms ?? index.columns,
    badges,
    include: included.length === 0 ? null : t("details.include", { columns: included.join(", ") }),
    expression: null,
    rule: index.native === undefined ? null : nativeRule(index.native.definition, words),
    ...(index.native === undefined
      ? {}
      : {
          nativeNotes: [
            t("details.native.method", { method: index.native.method }),
            t("details.native.indexState", {
              valid: yesNo(index.native.isValid, words),
              ready: yesNo(index.native.isReady, words),
              live: yesNo(index.native.isLive, words),
            }),
            ...(index.native.nullsNotDistinct ? [t("details.native.nullsNotDistinct")] : []),
            ...(index.native.wasClustered ? [t("details.native.clusterHistory")] : []),
            ...(index.native.predicate === null || definitionText(index.native.predicate) === null
              ? []
              : [`WHERE ${definitionText(index.native.predicate) ?? ""}`]),
            ...(index.nativeConstraint === undefined
              ? []
              : constraintNotes(index.nativeConstraint, words)),
          ],
        }),
  };
}

/** The badges of an enabled or disabled constraint, and of one SQL Server marks as not trusted. */
function constraintBadges(
  isEnabled: boolean | null,
  isTrusted: boolean | null,
  { t }: Words,
): BadgeView[] {
  if (isEnabled === false) {
    return [badge("disabled", t("details.badge.disabled"))];
  }
  // A disabled constraint is never trusted; only an enabled one is marked for it.
  return isEnabled === true && isTrusted === false
    ? [badge("untrusted", t("details.badge.untrusted"))]
    : [];
}

function checkItem(constraint: CheckFacts, entity: string, words: Words): ConstraintItemView {
  return {
    name: constraint.name,
    columns: [],
    badges: constraintBadges(constraint.isEnabled, constraint.isTrusted, words),
    include: null,
    expression: expressionView(constraint.expression, words),
    rule: checkRule(constraint, entity, words),
    ...(constraint.native === undefined
      ? {}
      : { nativeNotes: constraintNotes(constraint.native, words) }),
  };
}

function targetView(target: RelationTarget, { t }: Words): RelationTargetView {
  switch (target.status) {
    case "available":
      return {
        state: "available",
        label: qualifiedNameLabel(target.name),
        stateLabel: null,
        key: target.key,
        goLabel: t("details.target.go", { name: qualifiedNameLabel(target.name) }),
      };
    case "self":
      return {
        state: "self",
        label: qualifiedNameLabel(target.name),
        stateLabel: t("details.target.self"),
        key: null,
        goLabel: null,
      };
    case "hidden":
      return {
        state: "hidden",
        label: qualifiedNameLabel(target.name),
        stateLabel: t("details.target.hidden"),
        key: null,
        goLabel: null,
      };
    case "unknown":
      return {
        state: "unknown",
        label: qualifiedNameLabel(target.name),
        stateLabel: t("details.target.unknown"),
        key: null,
        goLabel: null,
      };
    case "notVisible":
      return {
        state: "notVisible",
        label: t("details.target.notVisible"),
        stateLabel: null,
        key: null,
        goLabel: null,
      };
  }
}

/**
 * A key: its name and column pairs, the other table, and its sentences, which say what its
 * actions do in place of the bare action names.
 */
function relationItem(relation: RelationFacts, words: Words): RelationItemView {
  const { t, date } = words;
  return {
    name: relation.name,
    columns: relation.columns.map((pair) =>
      pair.referenced === null ? pair.referencing : `${pair.referencing} → ${pair.referenced}`,
    ),
    badges: constraintBadges(relation.isEnabled, relation.isTrusted, words),
    target: targetView(relation.target, words),
    hint:
      relation.notCheckedSince === null
        ? null
        : t("details.hint.notChecked", { date: date(relation.notCheckedSince) }),
    rule: relationRule(relation, words),
    ...(relation.native === undefined
      ? {}
      : { nativeNotes: constraintNotes(relation.native, words) }),
  };
}

/**
 * The one line of an empty section. It says "None" only for a complete list; otherwise it
 * names what the list may be missing, so an absence never reads as a fact it is not.
 */
function emptyText(
  kind: Exclude<DetailSectionKind, "viewDefinition">,
  completeness: ListCompleteness,
  { t, date }: Words,
): string {
  switch (completeness.status) {
    case "complete":
      return t(`details.empty.${kind}`);
    case "notVisible":
      return t("details.empty.notVisible");
    case "notRecorded":
      return t("details.empty.notRecorded");
    case "notRead":
      return t(`trigger.notRead.${completeness.reason}`);
    case "notChecked":
      return t("details.empty.notChecked", { date: date(completeness.readAt) });
    case "diagram":
      return t("details.empty.diagram");
    case "inspectedSchemas":
      return t("details.empty.inspectedSchemas");
  }
}

/**
 * What a section with items may still be missing. Only "referenced by" needs it: keys from
 * tables the login cannot see are unknown, while outgoing keys to such tables are listed.
 */
function footnote(section: DetailSection, { t }: Words): string | null {
  return section.kind === "referencedBy" &&
    section.completeness.status === "notVisible" &&
    section.items.length > 0
    ? t("details.footnote.notVisible")
    : null;
}

/** A parent date in an export cannot stand in for the omitted code history. */
function triggerListNotice(
  section: Extract<DetailSection, { kind: "triggers" }>,
  words: Words,
): string {
  if (section.completeness.status === "notChecked" && !section.hasCodeHistory)
    return words.t("trigger.notChecked");
  if (section.completeness.status === "notRecorded" && section.items.length > 0)
    return words.t("trigger.listUnconfirmed");
  return emptyText("triggers", section.completeness, words);
}

/** A section of the entity `entity`, whose `CHECK`s highlight their columns on its card. */
function sectionView(section: DetailSection, entity: string, words: Words): SectionView {
  const { t } = words;
  if (section.kind === "viewDefinition") {
    const { included, hasCheckOption, isIndexed, native } = section.definition;
    return {
      kind: "viewDefinition",
      title: t("details.section.viewDefinition"),
      count: 0,
      completeness: "complete",
      emptyText: null,
      footnote: null,
      notes: [],
      included,
      stateLabel: included ? null : t("details.viewDefinition.notIncluded"),
      explanation: native === undefined ? null : t("details.native.reconstructed"),
      badges: [
        ...(native?.isMaterialized === true
          ? [
              {
                label: t("details.native.materializedView"),
                hint: t("details.native.populated", {
                  value: yesNo(native.isPopulated === true, words),
                }),
              },
            ]
          : []),
        ...(native !== undefined && native.checkOption !== "none"
          ? [
              {
                label: t("details.native.checkOption", { mode: native.checkOption.toUpperCase() }),
                hint: t("details.viewDefinition.checkOption"),
              },
            ]
          : []),
        ...(native === undefined && hasCheckOption === true
          ? [{ label: "WITH CHECK OPTION", hint: t("details.viewDefinition.checkOption") }]
          : []),
        ...(isIndexed === true
          ? [
              {
                label: t("details.viewDefinition.indexed"),
                hint: t("details.viewDefinition.indexedHint"),
              },
            ]
          : []),
      ],
    };
  }
  const base = {
    title: t(`details.section.${section.kind}`),
    count: section.items.length,
    completeness: section.completeness.status,
    emptyText:
      section.items.length === 0 ? emptyText(section.kind, section.completeness, words) : null,
    footnote: footnote(section, words),
    notes: sectionNotes(section, words),
  };
  switch (section.kind) {
    case "columns":
      return {
        ...base,
        kind: "columns",
        headers: {
          name: t("details.column.name"),
          type: t("details.column.type"),
          nullable: t("details.column.nullable"),
        },
        items: section.items.map((column) => columnItem(column, words)),
      };
    case "primaryKey":
      return {
        ...base,
        kind: "primaryKey",
        items: section.items.map((key) => keyItem(key, words)),
      };
    case "indexes":
      return {
        ...base,
        kind: "indexes",
        items: section.items.map((index) => indexItem(index, words)),
      };
    case "checks":
      return {
        ...base,
        kind: "checks",
        items: section.items.map((constraint) => checkItem(constraint, entity, words)),
      };
    case "nativeConstraints":
      return {
        ...base,
        kind: "nativeConstraints",
        items: section.items.map((constraint) => ({
          name: constraint.name,
          columns: [],
          badges: [],
          include: null,
          expression: null,
          rule: nativeRule(constraint.definition, words),
          nativeNotes: constraintNotes(constraint, words),
        })),
      };
    case "triggers":
      return {
        ...base,
        kind: "triggers",
        emptyText: section.items.length === 0 ? triggerListNotice(section, words) : null,
        items: section.items.map((trigger: TriggerFacts) => ({
          ...(trigger.provider === "postgreSql"
            ? { nativeNotes: triggerRunNotes(trigger, section.parentKind, words.translator) }
            : {}),
          name: trigger.name,
          ref: trigger.ref,
          events: presentTriggerEvents(trigger, words.translator),
          badges: presentTriggerBadges(trigger, words.translator),
          hint:
            trigger.notCheckedSince === null
              ? null
              : section.hasCodeHistory
                ? t("details.hint.notChecked", { date: words.date(trigger.notCheckedSince) })
                : t("trigger.notChecked"),
          openLabel: t("trigger.open", { name: trigger.name }),
        })),
        footnote:
          section.items.length > 0 && section.completeness.status !== "complete"
            ? triggerListNotice(section, words)
            : null,
        notes: triggerListNotes(section.items, section.parentKind, words.translator),
      };
    case "references":
      return {
        ...base,
        kind: "references",
        items: section.items.map((relation) => relationItem(relation, words)),
      };
    case "referencedBy":
      return {
        ...base,
        kind: "referencedBy",
        items: section.items.map((relation) => relationItem(relation, words)),
      };
  }
}

/** The details as translated text, ready for either renderer. */
export function presentObjectDetails(
  details: ObjectDetails,
  translator: DetailsTranslator,
): DetailsView {
  const words: Words = {
    t: translator.t,
    date: (readAt) => formatDate(readAt, translator.locale),
    translator,
  };
  const { t } = words;
  return {
    key: details.key,
    kind: details.kind,
    kindLabel:
      details.nativeKind === undefined
        ? t(details.kind === "view" ? "entity.view" : "entity.table")
        : t(`details.native.${details.nativeKind}`),
    schema: details.name.schema,
    name: details.name.name,
    summary: translator.tCount("entity.columns", details.columnCount),
    notice:
      details.notCheckedSince === null
        ? null
        : t("details.notice.notChecked", { date: words.date(details.notCheckedSince) }),
    sections: details.sections.map((section) => sectionView(section, details.key, words)),
  };
}

function yesNo(value: boolean, { t }: Words): string {
  return t(value ? "details.value.yes" : "details.value.no");
}

function nativeRule(definition: Parameters<typeof definitionText>[0], { t }: Words): RuleView {
  return {
    sentences: [],
    unread: t("details.native.ruleFallback"),
    sql: definitionText(definition),
    sqlNote: t("details.native.reconstructed"),
    targets: { columns: new Map(), relation: null },
  };
}

function constraintNotes(constraint: PostgresqlConstraint, words: Words): string[] {
  const { t } = words;
  return [
    t("details.native.validated", { value: yesNo(constraint.isValidated, words) }),
    ...(constraint.isEnforced === null
      ? [t("details.native.enforcementUnavailable")]
      : [t("details.native.enforced", { value: yesNo(constraint.isEnforced, words) })]),
    t("details.native.deferrable", {
      value: yesNo(constraint.isDeferrable, words),
      deferred: yesNo(constraint.isInitiallyDeferred, words),
    }),
    ...(constraint.matchType === null
      ? []
      : [t("details.native.match", { mode: constraint.matchType.toUpperCase() })]),
    ...(constraint.deleteSetColumns.length === 0
      ? []
      : [
          t("details.native.deleteSetColumns", { columns: constraint.deleteSetColumns.join(", ") }),
        ]),
  ];
}
