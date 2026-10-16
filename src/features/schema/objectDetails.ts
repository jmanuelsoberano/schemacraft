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
  PrimaryKey,
  QualifiedName,
  ReferentialAction,
  SchemaSnapshot,
  SnapshotFact,
  Table,
  View,
} from "@/shared/contracts";

import { formatDataType } from "./dataType";
import { definitionText, isUnknownDefinition } from "./definition";
import { entityKey } from "./entities";
import type { EntityKind } from "./entities";

/**
 * The facts about one table or view that the Inspector and the viewer's detail panel show,
 * each with how far the capture vouches for it. This module reads the snapshot; the
 * presentation (`objectDetailsView.ts`) turns the facts into translated text, and two renderers
 * draw that text, so both say the same about an object in the same words. What each one knows
 * beyond the snapshot comes in the scope: an exported file knows only the diagram.
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
}

export interface IndexFacts {
  name: string;
  columns: readonly string[];
  kind: IndexKind;
  isClustered: boolean;
}

export interface CheckFacts {
  name: string;
  expression: FactText;
  /** `null` when the file did not record whether the constraint is enabled. */
  isEnabled: boolean | null;
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
  /** The other table: the referenced one under "references", the referencing one under "referenced by". */
  target: RelationTarget;
  /** When the key was kept from an earlier read, the moment it was last read; `null` otherwise. */
  notCheckedSince: string | null;
}

export type DetailSectionKind =
  "columns" | "primaryKey" | "indexes" | "checks" | "references" | "referencedBy";

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
  | SectionFacts<"references", RelationFacts>
  | SectionFacts<"referencedBy", RelationFacts>;

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

/** The sections of a table, in the order both renderers show them. A view has columns only. */
export const TABLE_SECTIONS: readonly DetailSectionKind[] = [
  "columns",
  "primaryKey",
  "indexes",
  "checks",
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
  return { name: key.name, columns: key.columns, isClustered: key.isClustered };
}

function indexFacts(index: Index): IndexFacts {
  return {
    name: index.name,
    columns: index.columns,
    kind: index.kind,
    isClustered: index.isClustered,
  };
}

function checkFacts(constraint: CheckConstraint, texts: TextMoments): CheckFacts {
  return {
    name: constraint.name,
    expression: factText(
      constraint.expression,
      textReadAt(texts, { kind: "checkConstraint", name: constraint.name }),
    ),
    isEnabled: constraint.isEnabled,
  };
}

/** What the facts of one table are built from. */
interface TableContext {
  scope: DetailsScope;
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
    target: target(context, other),
    notCheckedSince:
      context.moments.get(
        carriedFactId(entityKey(key.referencingTable), { kind: "foreignKey", name: key.name }),
      ) ?? null,
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
    target: { status: "notVisible" },
    notCheckedSince:
      context.moments.get(carriedFactId(context.key, { kind: "foreignKey", name: key.name })) ??
      null,
  };
}

/** Columns, keys, indexes and `CHECK`s of a visible object are read in full. */
function ownCompleteness(objectReadAt: string | null): ListCompleteness {
  return objectReadAt === null
    ? { status: "complete" }
    : { status: "notChecked", readAt: objectReadAt };
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
    scope,
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
        items: table.checkConstraints.map((constraint) => checkFacts(constraint, texts)),
        completeness: ownCompleteness(context.objectReadAt),
      },
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

function describeView(view: View, scope: DetailsScope): ObjectDetails {
  const key = entityKey(view.name);
  const moments = readMoments(scope.carriedOver);
  const objectReadAt = moments.get(carriedFactId(key, { kind: "view" })) ?? null;
  const texts: TextMoments = { ownerKey: key, moments, objectReadAt };
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
    ],
  };
}

/**
 * The details of the table or view `key` names, or `null` when the snapshot has no such
 * entity. Tables get the six sections of {@link TABLE_SECTIONS}; views get their columns.
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
  return view === undefined ? null : describeView(view, scope);
}
