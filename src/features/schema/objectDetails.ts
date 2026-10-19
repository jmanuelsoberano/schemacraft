import type {
  AccessCoverage,
  CarriedFact,
  CheckConstraint,
  Column,
  Definition,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  Index,
  IndexKind,
  NotReadReason,
  PrimaryKey,
  QualifiedName,
  ReferentialAction,
  SchemaSnapshot,
  SnapshotFact,
  Table,
  Trigger,
  View,
} from "@/shared/contracts";

import { formatDataType } from "./dataType";
import { definitionText, isUnknownDefinition } from "./definition";
import { entityKey, foreignKeyId } from "./entities";
import type { EntityKind } from "./entities";
import { readCheckConstraint } from "./rules/checkReader";
import type { CheckReading } from "./rules/checkReader";
import { foreignKeyExplanation } from "./rules/foreignKeyReader";
import type { ExplanationScope, ForeignKeyExplanation } from "./rules/foreignKeyReader";
import { triggerCapture, triggerReadAt, triggersOf } from "./triggerDetails";
import type { ModuleRef } from "./modules";

/**
 * The facts about one table or view that the Inspector and the viewer's detail panel show,
 * each with how far the capture vouches for it, and its `CHECK`s and keys put into words by
 * the rule readers. This module reads the snapshot; the presentation (`objectDetailsView.ts`)
 * turns the facts into translated text, and two renderers draw that text, so both say the same
 * about an object in the same words. What each one knows beyond the snapshot comes in the
 * scope: an exported file knows only the diagram.
 */

/** What the Inspector or the viewer knows beyond the snapshot. */
export interface DetailsScope {
  /** Entities hidden on the canvas, which cannot be selected and so cannot be shown. */
  hiddenKeys: ReadonlySet<string>;
  /** What the login could see, or `null` when the capture recorded nothing (a 1.0 file). */
  coverage: AccessCoverage | null;
  /** Facts kept from an earlier read because the capture could not check them. */
  carriedOver: readonly CarriedFact[];
  /** The capture was limited to some schemas, so keys to tables outside them were dropped. */
  isSchemaFiltered: boolean;
  /** Only the entities and keys on the diagram are known, as in an exported HTML file. */
  isDiagramOnly: boolean;
  /** SQL definitions are available only in the desktop Inspector. */
  definitions: "included" | "excluded";
}

/**
 * The text of a `CHECK` or `DEFAULT`, or why it is missing: not visible to the login, never
 * recorded by the 1.0 file, or kept from an earlier read that this login could not check.
 */
export type FactText =
  | { status: "readable"; text: string }
  | { status: "notAvailable" }
  | { status: "notRecorded" }
  | { status: "notChecked"; text: string; readAt: string };

/**
 * Whether a list holds everything there is. "None" may be printed for an empty list only when
 * it is `complete`; every other value names what the list may be missing.
 */
export type ListCompleteness =
  | { status: "complete" }
  /** Other tables the login cannot see may hold what is missing. */
  | { status: "notVisible" }
  /** A 1.0 file, which dropped keys to tables the login could not see without a trace. */
  | { status: "notRecorded" }
  /** The optional trigger-metadata read was omitted or failed. */
  | { status: "notRead"; reason: NotReadReason }
  /** The object was kept from an earlier read, so this capture checked none of its lists. */
  | { status: "notChecked"; readAt: string }
  /** Only the diagram's entities and keys are known. */
  | { status: "diagram" }
  /** Keys to tables outside the inspected schemas were dropped by the capture. */
  | { status: "inspectedSchemas" };

export interface ColumnFacts {
  name: string;
  /** SQL declaration of the type, e.g. `nvarchar(120)`. */
  type: string;
  isNullable: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  isPrimaryKey: boolean;
  /** Part of a foreign key, to a visible table or to one the login cannot see. */
  isForeignKey: boolean;
  /** `null` when the column has no default. */
  defaultValue: FactText | null;
}

export interface KeyFacts {
  name: string;
  columns: readonly string[];
  isClustered: boolean;
  /** `false` when its index is disabled; `null` when the file did not record it (before 1.2). */
  isEnabled: boolean | null;
}

export interface IndexFacts {
  name: string;
  columns: readonly string[];
  kind: IndexKind;
  isClustered: boolean;
  /** `INCLUDE` columns in index order; `null` when the file did not record them. */
  includedColumns: readonly string[] | null;
  /** Whether it covers only the rows of a filter; `null` when the file did not record it. */
  isFiltered: boolean | null;
  /** `false` when it is disabled; `null` when the file did not record it. */
  isEnabled: boolean | null;
}

export interface CheckFacts {
  name: string;
  expression: FactText;
  /** `null` when the file did not record whether the constraint is enabled. */
  isEnabled: boolean | null;
  /**
   * `false` when SQL Server marks it as not trusted, so the rows already in the table may not
   * follow it; `null` when the file did not record it.
   */
  isTrusted: boolean | null;
  /** The constraint in words, or why it is not: its text cannot be read or put into words. */
  reading: CheckReading;
}

/** The table at the other end of a relation, and whether it can be shown. */
export type RelationTarget =
  /** On the canvas, so it can be selected and inspected. */
  | { status: "available"; key: string; name: QualifiedName }
  /** The inspected table itself. */
  | { status: "self"; key: string; name: QualifiedName }
  /** In the project but hidden on the canvas, so it cannot be selected. */
  | { status: "hidden"; key: string; name: QualifiedName }
  /** Named by the key but absent from the snapshot. */
  | { status: "unknown"; key: string; name: QualifiedName }
  /** Not visible to the login, which hides its name and its columns. */
  | { status: "notVisible" };

export interface ColumnPairFacts {
  /** Column of the referencing (child) table. */
  referencing: string;
  /** Column of the referenced (parent) table; `null` when that table is not visible. */
  referenced: string | null;
}

export interface RelationFacts {
  name: string;
  /** Column pairings in key order, from the referencing to the referenced table. */
  columns: readonly ColumnPairFacts[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
  isEnabled: boolean;
  /**
   * `false` when SQL Server marks it as not trusted, so the rows already in the referencing table
   * may not follow it; `null` when the file did not record it.
   */
  isTrusted: boolean | null;
  /** The other table: the referenced one under "references", the referencing one under "referenced by". */
  target: RelationTarget;
  /** When the key was kept from an earlier read, the moment it was last read; `null` otherwise. */
  notCheckedSince: string | null;
  /** The key in words, with the columns it involves and its SQL. */
  explanation: ForeignKeyExplanation;
  /**
   * The id of the relationship drawn for the key ({@link foreignKeyId}); `null` for a key to a
   * table the login cannot see, which no diagram draws.
   */
  relation: string | null;
}

export type DetailSectionKind =
  | "columns"
  | "primaryKey"
  | "indexes"
  | "checks"
  | "triggers"
  | "references"
  | "referencedBy"
  | "viewDefinition";

export interface TriggerFacts extends Omit<Trigger, "body"> {
  ref: Extract<ModuleRef, { kind: "trigger" }>;
  notCheckedSince: string | null;
}

export interface ViewDefinitionFacts {
  included: boolean;
  hasCheckOption: boolean | null;
  isIndexed: boolean | null;
}

interface SectionFacts<Kind extends DetailSectionKind, Item> {
  kind: Kind;
  items: readonly Item[];
  completeness: ListCompleteness;
}

/** One section of the details, in the fixed order {@link TABLE_SECTIONS} gives them. */
export type DetailSection =
  | SectionFacts<"columns", ColumnFacts>
  | SectionFacts<"primaryKey", KeyFacts>
  | SectionFacts<"indexes", IndexFacts>
  | SectionFacts<"checks", CheckFacts>
  | (SectionFacts<"triggers", TriggerFacts> & {
      parentKind: EntityKind;
      /** The desktop has code dates; an export keeps only its parent's history. */
      hasCodeHistory: boolean;
    })
  | SectionFacts<"references", RelationFacts>
  | SectionFacts<"referencedBy", RelationFacts>
  | { kind: "viewDefinition"; definition: ViewDefinitionFacts };

export interface ObjectDetails {
  key: string;
  name: QualifiedName;
  kind: EntityKind;
  columnCount: number;
  /** When the whole object was kept from an earlier read, the moment it was last read. */
  notCheckedSince: string | null;
  /** Every section that applies to the kind, in a fixed order, empty ones included. */
  sections: readonly DetailSection[];
}

/** The sections of a table in both renderers. Views have columns, triggers and definition. */
export const TABLE_SECTIONS: readonly DetailSectionKind[] = [
  "columns",
  "primaryKey",
  "indexes",
  "checks",
  "triggers",
  "references",
  "referencedBy",
];

/** Identity of a carried fact: its object's key, the kind of fact and what it names. */
function carriedFactId(key: string, fact: SnapshotFact): string {
  switch (fact.kind) {
    case "table":
    case "view":
      return JSON.stringify([key, fact.kind]);
    case "columnDefault":
      return JSON.stringify([key, fact.kind, fact.column]);
    case "checkConstraint":
    case "foreignKey":
      return JSON.stringify([key, fact.kind, fact.name]);
  }
}

/** The moments facts were last read, looked up by object and fact. Keys are recorded on their referencing table. */
type ReadMoments = ReadonlyMap<string, string>;

function readMoments(carried: readonly CarriedFact[]): ReadMoments {
  return new Map(
    carried.map((entry) => [carriedFactId(entityKey(entry.object), entry.fact), entry.readAt]),
  );
}

/** The text of a definition with how far it is vouched for; `readAt` when it was kept. */
function factText(definition: Definition, readAt: string | undefined): FactText {
  const text = definitionText(definition);
  if (text === null) {
    return { status: isUnknownDefinition(definition) ? "notRecorded" : "notAvailable" };
  }
  return readAt === undefined
    ? { status: "readable", text }
    : { status: "notChecked", text, readAt };
}

/** Where the texts of one object were last read. */
interface TextMoments {
  ownerKey: string;
  moments: ReadMoments;
  /** When the whole object was kept from an earlier read, which then read every text in it. */
  objectReadAt: string | null;
}

/**
 * When a text was last read if this capture did not read it: its own moment when it was kept
 * on its own, which may be earlier than its object's, or else the moment of the object kept
 * whole around it.
 */
function textReadAt(texts: TextMoments, fact: SnapshotFact): string | undefined {
  return texts.moments.get(carriedFactId(texts.ownerKey, fact)) ?? texts.objectReadAt ?? undefined;
}

function columnFacts(
  column: Column,
  texts: TextMoments,
  primaryKeyColumns: ReadonlySet<string>,
  foreignKeyColumns: ReadonlySet<string>,
): ColumnFacts {
  return {
    name: column.name,
    type: formatDataType(column.dataType),
    isNullable: column.isNullable,
    isIdentity: column.isIdentity,
    isComputed: column.isComputed,
    isPrimaryKey: primaryKeyColumns.has(column.name),
    isForeignKey: foreignKeyColumns.has(column.name),
    defaultValue:
      column.defaultExpression === null
        ? null
        : factText(
            column.defaultExpression,
            textReadAt(texts, { kind: "columnDefault", column: column.name }),
          ),
  };
}

function keyFacts(key: PrimaryKey): KeyFacts {
  return {
    name: key.name,
    columns: key.columns,
    isClustered: key.isClustered,
    isEnabled: key.isEnabled ?? null,
  };
}

function indexFacts(index: Index): IndexFacts {
  return {
    name: index.name,
    columns: index.columns,
    kind: index.kind,
    isClustered: index.isClustered,
    includedColumns: index.includedColumns ?? null,
    isFiltered: index.isFiltered ?? null,
    isEnabled: index.isEnabled ?? null,
  };
}

/**
 * A `CHECK` of `table`, whose texts `texts` dates, read against the table's columns. A text kept
 * from an earlier read is read as well; its date says how far it is vouched for.
 */
function checkFacts(constraint: CheckConstraint, table: Table, texts: TextMoments): CheckFacts {
  return {
    name: constraint.name,
    expression: factText(
      constraint.expression,
      textReadAt(texts, { kind: "checkConstraint", name: constraint.name }),
    ),
    isEnabled: constraint.isEnabled,
    isTrusted: constraint.isTrusted ?? null,
    reading: readCheckConstraint(constraint, table.columns, table.name),
  };
}

/**
 * What the key readers know beyond the snapshot, from the details' scope: an exported file's
 * snapshot travels without its access profile and kept facts, which come beside it, so the
 * Inspector and the viewer word a key the same.
 */
function explanationScope(scope: DetailsScope): ExplanationScope {
  return { hasAccessProfile: scope.coverage !== null, carriedOver: scope.carriedOver };
}

/** What the facts of one table are built from. */
interface TableContext {
  snapshot: SchemaSnapshot;
  scope: DetailsScope;
  /** The scope of the key readers, taken once from {@link scope}. */
  explanationScope: ExplanationScope;
  key: string;
  /** Keys of every table and view of the snapshot. */
  entityKeys: ReadonlySet<string>;
  moments: ReadMoments;
  /** When the whole table was kept from an earlier read. */
  objectReadAt: string | null;
}

function target(context: TableContext, name: QualifiedName): RelationTarget {
  const key = entityKey(name);
  if (key === context.key) {
    return { status: "self", key, name };
  }
  if (!context.entityKeys.has(key)) {
    return { status: "unknown", key, name };
  }
  return { status: context.scope.hiddenKeys.has(key) ? "hidden" : "available", key, name };
}

function relation(context: TableContext, key: ForeignKey, other: QualifiedName): RelationFacts {
  return {
    name: key.name,
    columns: key.columnPairs.map((pair) => ({
      referencing: pair.referencingColumn,
      referenced: pair.referencedColumn,
    })),
    onDelete: key.onDelete,
    onUpdate: key.onUpdate,
    isEnabled: key.isEnabled,
    isTrusted: key.isTrusted ?? null,
    target: target(context, other),
    notCheckedSince:
      context.moments.get(
        carriedFactId(entityKey(key.referencingTable), { kind: "foreignKey", name: key.name }),
      ) ?? null,
    explanation: foreignKeyExplanation(context.snapshot, key, context.explanationScope),
    relation: foreignKeyId(key),
  };
}

function relationToInvisibleTable(
  context: TableContext,
  key: ForeignKeyToInvisibleTable,
): RelationFacts {
  return {
    name: key.name,
    columns: key.columns.map((column) => ({ referencing: column, referenced: null })),
    onDelete: key.onDelete,
    onUpdate: key.onUpdate,
    isEnabled: key.isEnabled,
    isTrusted: key.isTrusted ?? null,
    target: { status: "notVisible" },
    notCheckedSince:
      context.moments.get(carriedFactId(context.key, { kind: "foreignKey", name: key.name })) ??
      null,
    explanation: foreignKeyExplanation(context.snapshot, key, context.explanationScope),
    relation: null,
  };
}

/** Columns, keys, indexes and `CHECK`s of a visible object are read in full. */
function ownCompleteness(objectReadAt: string | null): ListCompleteness {
  return objectReadAt === null
    ? { status: "complete" }
    : { status: "notChecked", readAt: objectReadAt };
}

function triggerSection(
  snapshot: SchemaSnapshot,
  parent: QualifiedName,
  parentKind: EntityKind,
  scope: DetailsScope,
): Extract<DetailSection, { kind: "triggers" }> {
  const completeness = triggerCapture(snapshot, parent, scope.carriedOver);
  const parentDate =
    scope.carriedOver.find(
      (item) =>
        entityKey(item.object) === entityKey(parent) &&
        (item.fact.kind === "table" || item.fact.kind === "view"),
    )?.readAt ?? null;
  return {
    kind: "triggers",
    parentKind,
    hasCodeHistory: scope.definitions === "included",
    completeness,
    items: triggersOf(snapshot, parent).map((trigger) => ({
      parent: trigger.parent,
      name: trigger.name,
      timing: trigger.timing,
      events: trigger.events,
      isEnabled: trigger.isEnabled,
      isNotForReplication: trigger.isNotForReplication,
      ref: { kind: "trigger", parent: trigger.parent, name: trigger.name },
      notCheckedSince: triggerReadAt(snapshot, trigger) ?? parentDate,
    })),
  };
}

/**
 * Outgoing keys are complete once the ones to tables the login cannot see are listed, which a
 * format-2 capture does; incoming keys from such tables are unknown, so under partial coverage
 * other tables may reference this one. A 1.0 file dropped both kinds silently.
 */
function relationCompleteness(
  context: TableContext,
  direction: "references" | "referencedBy",
): ListCompleteness {
  const { coverage, isDiagramOnly, isSchemaFiltered } = context.scope;
  if (context.objectReadAt !== null) {
    return { status: "notChecked", readAt: context.objectReadAt };
  }
  if (direction === "referencedBy" && coverage !== null && coverage.objects !== "complete") {
    return { status: "notVisible" };
  }
  if (coverage === null) {
    return { status: "notRecorded" };
  }
  if (isDiagramOnly) {
    return { status: "diagram" };
  }
  if (isSchemaFiltered) {
    return { status: "inspectedSchemas" };
  }
  return { status: "complete" };
}

function describeTable(snapshot: SchemaSnapshot, table: Table, scope: DetailsScope): ObjectDetails {
  const key = entityKey(table.name);
  const moments = readMoments(scope.carriedOver);
  const context: TableContext = {
    snapshot,
    scope,
    explanationScope: explanationScope(scope),
    key,
    entityKeys: new Set([
      ...snapshot.tables.map((candidate) => entityKey(candidate.name)),
      ...snapshot.views.map((candidate) => entityKey(candidate.name)),
    ]),
    moments,
    objectReadAt: moments.get(carriedFactId(key, { kind: "table" })) ?? null,
  };
  const outgoingKeys = snapshot.foreignKeys.filter(
    (candidate) => entityKey(candidate.referencingTable) === key,
  );
  const keysToInvisibleTables = (snapshot.foreignKeysToInvisibleTables ?? []).filter(
    (candidate) => entityKey(candidate.referencingTable) === key,
  );
  const incomingKeys = snapshot.foreignKeys.filter(
    (candidate) =>
      entityKey(candidate.referencedTable) === key && entityKey(candidate.referencingTable) !== key,
  );
  const primaryKeyColumns = new Set(table.primaryKey?.columns ?? []);
  const foreignKeyColumns = new Set([
    ...outgoingKeys.flatMap((candidate) =>
      candidate.columnPairs.map((pair) => pair.referencingColumn),
    ),
    ...keysToInvisibleTables.flatMap((candidate) => candidate.columns),
  ]);
  const texts: TextMoments = { ownerKey: key, moments, objectReadAt: context.objectReadAt };

  return {
    key,
    name: table.name,
    kind: "table",
    columnCount: table.columns.length,
    notCheckedSince: context.objectReadAt,
    sections: [
      {
        kind: "columns",
        items: table.columns.map((column) =>
          columnFacts(column, texts, primaryKeyColumns, foreignKeyColumns),
        ),
        completeness: ownCompleteness(context.objectReadAt),
      },
      {
        kind: "primaryKey",
        items: table.primaryKey === null ? [] : [keyFacts(table.primaryKey)],
        completeness: ownCompleteness(context.objectReadAt),
      },
      {
        kind: "indexes",
        items: table.indexes.map(indexFacts),
        completeness: ownCompleteness(context.objectReadAt),
      },
      {
        kind: "checks",
        items: table.checkConstraints.map((constraint) => checkFacts(constraint, table, texts)),
        completeness: ownCompleteness(context.objectReadAt),
      },
      triggerSection(snapshot, table.name, "table", scope),
      {
        kind: "references",
        items: [
          ...outgoingKeys.map((candidate) =>
            relation(context, candidate, candidate.referencedTable),
          ),
          ...keysToInvisibleTables.map((candidate) => relationToInvisibleTable(context, candidate)),
        ],
        completeness: relationCompleteness(context, "references"),
      },
      {
        kind: "referencedBy",
        items: incomingKeys.map((candidate) =>
          relation(context, candidate, candidate.referencingTable),
        ),
        completeness: relationCompleteness(context, "referencedBy"),
      },
    ],
  };
}

function describeView(snapshot: SchemaSnapshot, view: View, scope: DetailsScope): ObjectDetails {
  const key = entityKey(view.name);
  const moments = readMoments(scope.carriedOver);
  const objectReadAt = moments.get(carriedFactId(key, { kind: "view" })) ?? null;
  const texts: TextMoments = { ownerKey: key, moments, objectReadAt };
  const module = snapshot.programmability?.views.find((item) => entityKey(item.view) === key);
  return {
    key,
    name: view.name,
    kind: "view",
    columnCount: view.columns.length,
    notCheckedSince: objectReadAt,
    sections: [
      {
        kind: "columns",
        items: view.columns.map((column) => columnFacts(column, texts, new Set(), new Set())),
        completeness: ownCompleteness(objectReadAt),
      },
      triggerSection(snapshot, view.name, "view", scope),
      {
        kind: "viewDefinition",
        definition: {
          included: scope.definitions === "included",
          hasCheckOption: module?.hasCheckOption ?? null,
          isIndexed: module?.isIndexed ?? null,
        },
      },
    ],
  };
}

/**
 * The details of the table or view `key` names, or `null` when the snapshot has no such
 * entity. Tables get {@link TABLE_SECTIONS}; views get columns, triggers and definition.
 */
export function describeObjectDetails(
  snapshot: SchemaSnapshot,
  key: string,
  scope: DetailsScope,
): ObjectDetails | null {
  const table = snapshot.tables.find((candidate) => entityKey(candidate.name) === key);
  if (table !== undefined) {
    return describeTable(snapshot, table, scope);
  }
  const view = snapshot.views.find((candidate) => entityKey(candidate.name) === key);
  return view === undefined ? null : describeView(snapshot, view, scope);
}
