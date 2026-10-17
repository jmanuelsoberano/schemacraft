import { formatDate } from "@/shared/i18n/formatDate";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import type { EntityKind } from "./entities";
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
} from "./objectDetails";
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

export type BadgeKind =
  "primaryKey" | "foreignKey" | "identity" | "computed" | "unique" | "clustered" | "disabled";

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
  /** The sentences in order; empty when the rule cannot be put into words. */
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
  name: string;
  /** Key columns in key order; empty for a `CHECK`. */
  columns: readonly string[];
  badges: readonly BadgeView[];
  /**
   * The `CHECK` text, or the words for its missing text with why it is missing; `null` for keys
   * and indexes. A renderer shows it when there is no {@link rule}, and its hint otherwise.
   */
  expression: ValueView | null;
  /** The `CHECK` in words or as SQL; `null` for keys, indexes and a `CHECK` without its text. */
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

export type ConstraintSectionKind = "primaryKey" | "indexes" | "checks";

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

/** One member per section kind, so a renderer can pick a section by its `kind` alone. */
export type SectionView =
  | ColumnsSectionView
  | ConstraintSectionView<"primaryKey">
  | ConstraintSectionView<"indexes">
  | ConstraintSectionView<"checks">
  | RelationSectionView<"references">
  | RelationSectionView<"referencedBy">;

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
 * cannot be put into words; `null` when its text is missing, which the expression says.
 */
function checkRule(constraint: CheckFacts, entity: string, words: Words): RuleView | null {
  const { reading } = constraint;
  if (reading.status === "notAvailable" || reading.status === "notRecorded") {
    return null;
  }
  const targets: RuleTargets = {
    columns: new Map(reading.columns.length === 0 ? [] : [[entity, reading.columns]]),
    relation: null,
  };
  return reading.status === "read"
    ? {
        sentences: ruleNodes(reading.rules, words.translator),
        unread: null,
        sql: reading.sql,
        sqlNote: null,
        targets,
      }
    : {
        sentences: [],
        unread: words.t("rule.check.unread"),
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
    unread: null,
    sql: explanation.sql,
    sqlNote: explanation.sql === null ? null : words.t("rule.fk.sqlNote"),
    targets: { columns: explanation.columns, relation: relation.relation },
  };
}

/** The notes in the order a section shows them; `derived` applies to every rule in words. */
type SectionNote = RuleNote | "derived";

const SECTION_NOTES: readonly SectionNote[] = ["pattern", "collation", "derived"];

/**
 * The notes under a section: for `CHECK`s, those their readings need and the derived note when
 * any is in words; for keys, which are always in words, the derived note.
 */
function sectionNotes(section: DetailSection, { t }: Words): string[] {
  const needed = new Set<SectionNote>();
  if (section.kind === "checks") {
    for (const { reading } of section.items) {
      if (reading.status === "read") {
        needed.add("derived");
        for (const note of reading.notes) {
          needed.add(note);
        }
      }
    }
  } else if (
    (section.kind === "references" || section.kind === "referencedBy") &&
    section.items.length > 0
  ) {
    needed.add("derived");
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
    badges.push(badge("identity", t("details.badge.identity")));
  }
  if (column.isComputed) {
    badges.push(badge("computed", t("details.badge.computed")));
  }
  return {
    name: column.name,
    type: column.type,
    isNullable: column.isNullable,
    nullable: t(column.isNullable ? "details.value.yes" : "details.value.no"),
    badges,
    defaultValue: column.defaultValue === null ? null : defaultView(column.defaultValue, words),
  };
}

function keyItem(key: KeyFacts, { t }: Words): ConstraintItemView {
  return {
    name: key.name,
    columns: key.columns,
    badges: key.isClustered ? [badge("clustered", t("indexKind.clustered"))] : [],
    expression: null,
    rule: null,
  };
}

function indexItem(index: IndexFacts, { t }: Words): ConstraintItemView {
  const badges: BadgeView[] = [];
  if (index.kind !== "nonUnique") {
    badges.push(badge("unique", t(`indexKind.${index.kind}`)));
  }
  if (index.isClustered) {
    badges.push(badge("clustered", t("indexKind.clustered")));
  }
  return { name: index.name, columns: index.columns, badges, expression: null, rule: null };
}

function checkItem(constraint: CheckFacts, entity: string, words: Words): ConstraintItemView {
  return {
    name: constraint.name,
    columns: [],
    badges:
      constraint.isEnabled === false ? [badge("disabled", words.t("details.badge.disabled"))] : [],
    expression: expressionView(constraint.expression, words),
    rule: checkRule(constraint, entity, words),
  };
}

function targetView(target: RelationTarget, { t }: Words): RelationTargetView {
  switch (target.status) {
    case "available":
      return {
        state: "available",
        label: target.key,
        stateLabel: null,
        key: target.key,
        goLabel: t("details.target.go", { name: target.key }),
      };
    case "self":
      return {
        state: "self",
        label: target.key,
        stateLabel: t("details.target.self"),
        key: null,
        goLabel: null,
      };
    case "hidden":
      return {
        state: "hidden",
        label: target.key,
        stateLabel: t("details.target.hidden"),
        key: null,
        goLabel: null,
      };
    case "unknown":
      return {
        state: "unknown",
        label: target.key,
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
    badges: relation.isEnabled ? [] : [badge("disabled", t("details.badge.disabled"))],
    target: targetView(relation.target, words),
    hint:
      relation.notCheckedSince === null
        ? null
        : t("details.hint.notChecked", { date: date(relation.notCheckedSince) }),
    rule: relationRule(relation, words),
  };
}

/**
 * The one line of an empty section. It says "None" only for a complete list; otherwise it
 * names what the list may be missing, so an absence never reads as a fact it is not.
 */
function emptyText(
  kind: DetailSectionKind,
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

/** A section of the entity `entity`, whose `CHECK`s highlight their columns on its card. */
function sectionView(section: DetailSection, entity: string, words: Words): SectionView {
  const { t } = words;
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
    kindLabel: t(details.kind === "view" ? "entity.view" : "entity.table"),
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
