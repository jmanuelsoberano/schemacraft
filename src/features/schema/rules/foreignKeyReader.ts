import type {
  CarriedFact,
  Column,
  ForeignKey,
  ForeignKeyToInvisibleTable,
  QualifiedName,
  ReferentialAction,
  SchemaSnapshot,
  Table,
} from "@/shared/contracts";
import type { RuleMessageKey, RulePluralBase } from "@/shared/i18n/messages/rules/en";

import { definitionText } from "../definition";
import { entityKey } from "../entities";
import { quoteIdentifier } from "../sqlIdentifiers";
import { countedSentence, enabledRules, sentence } from "./ruleText";
import type { RuleArgument, RuleArguments, RuleNode, RuleText } from "./ruleText";

/**
 * Puts a foreign key into words: which rows belong to which, how many referencing rows one
 * referenced row can have, and what deleting or changing a referenced row does. Tables are
 * named as tables ("each row in sales.Orders"), never turned into nouns, so every sentence
 * reads right in both languages whatever the tables are called. Every claim is one SQL Server
 * makes good on when values are written, as far as the snapshot can tell (see
 * {@link ChildCardinality} for what it does not record), and the integration tests pin the
 * engine facts the sentences rest on: a disabled key checks nothing, a row with a NULL in any
 * column of the key is not checked, NO ACTION is checked once the statement has run, an
 * identity column cannot be updated, and SET DEFAULT falls back to NULL.
 */

/**
 * Whether a referencing row must point to a referenced row: `required` when every referencing
 * column is NOT NULL, `optional` when any accepts NULL (SQL Server checks a composite key only
 * when all its columns have a value), `unknown` when the columns are not all known.
 */
export type ForeignKeyOptionality = "required" | "optional" | "unknown";

/**
 * How many referencing rows one referenced row can have: `atMostOne` when the primary key or a
 * unique constraint of the referencing table lies within the key's columns, `unknown` when only
 * a unique index does (the snapshot does not record whether an index is filtered, and a
 * filtered one allows several), `many` otherwise. The snapshot does not record whether an
 * index is disabled either, so a unique constraint or a nonclustered primary key whose index
 * is disabled, which no longer limits anything, still gives `atMostOne` until index state is
 * captured.
 */
export type ChildCardinality = "many" | "atMostOne" | "unknown";

export interface ForeignKeyExplanation {
  optionality: ForeignKeyOptionality;
  /** `null` for a key to a table the login cannot see, whose referenced side is unknown. */
  childCardinality: ChildCardinality | null;
  /** The sentences in order, under "When enabled:" for a disabled key. */
  rules: readonly RuleNode[];
  /**
   * The ON DELETE sentence alone, the one fact a one-line label has room for. On a disabled
   * key it holds only once the key is enabled, as `rules` says.
   */
  deleteRule: RuleText;
  /**
   * The columns the key involves, by entity key, to highlight: the referencing ones, then the
   * referenced ones. A self-reference lists both under its one table.
   */
  columns: ReadonlyMap<string, readonly string[]>;
  /** The key as SQL, scripted from the catalog; `null` when the referenced side is unknown. */
  sql: string | null;
}

type AnyForeignKey = ForeignKey | ForeignKeyToInvisibleTable;

/**
 * What the reader knows beyond the tables and keys, which SET DEFAULT depends on: a default it
 * may not take for granted. The application reads it from the snapshot; the exported viewer,
 * whose snapshot travels without its access profile and kept facts, passes the ones its file
 * carries beside it, so both say the same.
 */
export interface ExplanationScope {
  /**
   * Whether the capture recorded what the login could see. A SchemaCraft 1.0 file did not, and
   * it left out the defaults it could not read, so a column without one may still have one.
   */
  hasAccessProfile: boolean;
  /** Facts kept from an earlier read, which this capture could not check. */
  carriedOver: readonly CarriedFact[];
}

const NO_FACTS: readonly CarriedFact[] = [];

/** The scope a snapshot carries itself, as every snapshot of the application does. */
export function snapshotExplanationScope(snapshot: SchemaSnapshot): ExplanationScope {
  return {
    hasAccessProfile: snapshot.access !== undefined,
    carriedOver: snapshot.carriedOver ?? NO_FACTS,
  };
}

const ACTION_SQL: Readonly<Record<ReferentialAction, string>> = {
  noAction: "NO ACTION",
  cascade: "CASCADE",
  setNull: "SET NULL",
  setDefault: "SET DEFAULT",
};

function referencingColumnNames(key: AnyForeignKey): readonly string[] {
  return "columnPairs" in key ? key.columnPairs.map((pair) => pair.referencingColumn) : key.columns;
}

function findTable(snapshot: SchemaSnapshot, name: QualifiedName): Table | undefined {
  const key = entityKey(name);
  return snapshot.tables.find((candidate) => entityKey(candidate.name) === key);
}

/** Whether a row must point to a referenced row through `key`, judged from the columns of its table. */
export function foreignKeyOptionality(
  referencingColumns: readonly Column[],
  key: AnyForeignKey,
): ForeignKeyOptionality {
  const columns = referencingColumnNames(key).map((name) =>
    referencingColumns.find((candidate) => candidate.name === name),
  );
  if (columns.length === 0 || columns.some((column) => column === undefined)) {
    return "unknown";
  }
  return columns.some((column) => column?.isNullable === true) ? "optional" : "required";
}

/** How many rows of `referencingTable` one referenced row can have through `key`. */
export function foreignKeyChildCardinality(
  referencingTable: Table | undefined,
  key: AnyForeignKey,
): ChildCardinality {
  if (referencingTable === undefined) {
    return "unknown";
  }
  const keyColumns = new Set(referencingColumnNames(key));
  const within = (columns: readonly string[]) =>
    columns.length > 0 && columns.every((column) => keyColumns.has(column));
  const { primaryKey, indexes } = referencingTable;
  if (
    (primaryKey !== null && within(primaryKey.columns)) ||
    indexes.some((index) => index.kind === "uniqueConstraint" && within(index.columns))
  ) {
    return "atMostOne";
  }
  return indexes.some((index) => index.kind === "uniqueIndex" && within(index.columns))
    ? "unknown"
    : "many";
}

/**
 * The key as an `ALTER TABLE … ADD CONSTRAINT` statement, scripted from the catalog: ON DELETE
 * and ON UPDATE only when they are not NO ACTION. A disabled key is added `WITH NOCHECK`, as
 * the rows it let in may not follow it, and then disabled with a NOCHECK statement. Names are
 * bracketed with closing brackets doubled.
 */
export function foreignKeyDefinitionSql(key: ForeignKey): string {
  const table = (name: QualifiedName) =>
    `${quoteIdentifier(name.schema)}.${quoteIdentifier(name.name)}`;
  const list = (names: readonly string[]) => names.map(quoteIdentifier).join(", ");
  const referencing = list(key.columnPairs.map((pair) => pair.referencingColumn));
  const referenced = list(key.columnPairs.map((pair) => pair.referencedColumn));
  const check = key.isEnabled ? "" : " WITH NOCHECK";
  const lines = [
    `ALTER TABLE ${table(key.referencingTable)}${check} ADD CONSTRAINT ${quoteIdentifier(key.name)}`,
    `  FOREIGN KEY (${referencing}) REFERENCES ${table(key.referencedTable)} (${referenced})`,
  ];
  if (key.onDelete !== "noAction") {
    lines.push(`  ON DELETE ${ACTION_SQL[key.onDelete]}`);
  }
  if (key.onUpdate !== "noAction") {
    lines.push(`  ON UPDATE ${ACTION_SQL[key.onUpdate]}`);
  }
  const statement = `${lines.join("\n")};`;
  return key.isEnabled
    ? statement
    : `${statement}\nALTER TABLE ${table(key.referencingTable)} NOCHECK CONSTRAINT ${quoteIdentifier(key.name)};`;
}

/** What SET DEFAULT puts in the referencing columns, as far as the snapshot can tell. */
type DefaultsState =
  /** Every column has a DEFAULT with a value, so the row must then point to another parent. */
  | "values"
  /** No column has one, so they all become NULL, which needs no parent. */
  | "none"
  /** Some defaults are not visible, not recorded, kept from an earlier read, or mixed. */
  | "unknown";

const NULL_DEFAULT = /^[\s(]*null[\s)]*$/iu;

function defaultsState(
  scope: ExplanationScope,
  referencingTable: Table | undefined,
  columns: readonly string[],
): DefaultsState {
  if (!scope.hasAccessProfile || referencingTable === undefined) {
    return "unknown";
  }
  const owner = entityKey(referencingTable.name);
  // A default kept from an earlier read may have changed since.
  const carried = scope.carriedOver.filter((entry) => entityKey(entry.object) === owner);
  const states = columns.map((name) => {
    const column = referencingTable.columns.find((candidate) => candidate.name === name);
    const isCarried = carried.some(
      (entry) =>
        entry.fact.kind === "table" ||
        (entry.fact.kind === "columnDefault" && entry.fact.column === name),
    );
    if (column === undefined || isCarried) {
      return "unknown";
    }
    if (column.defaultExpression === null) {
      // SQL Server refuses SET DEFAULT on a NOT NULL column without a default, so this one
      // becomes NULL; a NOT NULL one here would mean the snapshot is not what it seems.
      return column.isNullable ? "none" : "unknown";
    }
    const text = definitionText(column.defaultExpression);
    if (text === null) {
      return "unknown";
    }
    return NULL_DEFAULT.test(text) ? "none" : "values";
  });
  if (states.every((state) => state === "values")) {
    return "values";
  }
  return states.every((state) => state === "none") ? "none" : "unknown";
}

/** What the sentences of one key are built from. */
interface Sides {
  child: RuleArgument;
  parent: RuleArgument;
  /** All the referencing columns. */
  columns: RuleArgument;
  /** The referenced key columns, or "the referenced key" when they are unknown. */
  parentColumns: RuleArgument;
  columnCount: number;
  isSelf: boolean;
  /** Whether the referenced key is one identity column, which never changes. */
  isIdentityKey: boolean;
  defaults: DefaultsState;
}

function args(sides: Sides, extra: RuleArguments = {}): RuleArguments {
  return {
    child: sides.child,
    parent: sides.parent,
    columns: sides.columns,
    parentColumns: sides.parentColumns,
    ...extra,
  };
}

function setDefaultSentence(sides: Sides, on: "delete" | "update"): RuleNode {
  const variant: Readonly<Record<DefaultsState, RulePluralBase>> =
    on === "delete"
      ? {
          values: "rule.fk.delete.setDefault",
          none: "rule.fk.delete.setDefaultNull",
          unknown: "rule.fk.delete.setDefaultNeutral",
        }
      : {
          values: "rule.fk.update.setDefault",
          none: "rule.fk.update.setDefaultNull",
          unknown: "rule.fk.update.setDefaultNeutral",
        };
  return countedSentence(variant[sides.defaults], sides.columnCount, args(sides));
}

/**
 * The delete sentence. NO ACTION is checked once the statement has run, cascades included, so
 * its sentences speak of the rows that still point to the row then: one statement can delete a
 * row with the rows that point to it, or a row that only it points to.
 */
function deleteSentence(sides: Sides, action: ReferentialAction): RuleNode {
  const keys: Readonly<Record<Exclude<ReferentialAction, "setDefault">, RuleMessageKey>> = {
    noAction: sides.isSelf ? "rule.fk.self.delete.noAction" : "rule.fk.delete.noAction",
    cascade: "rule.fk.delete.cascade",
    setNull: "rule.fk.delete.setNull",
  };
  return action === "setDefault"
    ? setDefaultSentence(sides, "delete")
    : sentence(keys[action], args(sides));
}

/**
 * The update sentence, or nothing for NO ACTION on a key that can never change. NO ACTION is
 * checked once the statement has run, as for a delete, so a change is blocked only by rows that
 * then still point to the old value when no row has it any more: a statement can re-key a row
 * that points to itself along with its own column, or swap the keys of two rows.
 */
function updateSentences(sides: Sides, action: ReferentialAction): RuleNode[] {
  if (sides.isIdentityKey) {
    return action === "noAction"
      ? []
      : [
          sentence(
            "rule.fk.update.identity",
            args(sides, { action: { kind: "keyword", text: ACTION_SQL[action] } }),
          ),
        ];
  }
  switch (action) {
    case "noAction":
      return [
        countedSentence(
          sides.isSelf ? "rule.fk.self.update.noAction" : "rule.fk.update.noAction",
          sides.columnCount,
          args(sides),
        ),
      ];
    case "cascade":
      return [sentence("rule.fk.update.cascade", args(sides))];
    case "setNull":
      return [sentence("rule.fk.update.setNull", args(sides))];
    case "setDefault":
      return [setDefaultSentence(sides, "update")];
  }
}

/** "Each row in … belongs to …", by how the referencing columns accept NULL. */
function belongsTo(
  sides: Sides,
  optionality: ForeignKeyOptionality,
  nullable: readonly string[],
  childEntity: string,
  variant: "plain" | "self" | "invisible",
): RuleNode {
  const required: Readonly<Record<typeof variant, RuleMessageKey>> = {
    plain: "rule.fk.required",
    self: "rule.fk.self.required",
    invisible: "rule.fk.invisible.required",
  };
  const optional: Readonly<Record<typeof variant, RulePluralBase>> = {
    plain: "rule.fk.optional",
    self: "rule.fk.self.optional",
    invisible: "rule.fk.invisible.optional",
  };
  switch (optionality) {
    case "required":
      return sentence(required[variant], args(sides));
    case "optional":
      return countedSentence(
        optional[variant],
        nullable.length,
        args(sides, {
          columns: { kind: "columns", entity: childEntity, names: nullable, join: "and" },
        }),
      );
    case "unknown":
      return sentence(
        variant === "invisible" ? "rule.fk.invisible.unknown" : "rule.fk.unknown",
        args(sides),
      );
  }
}

/** "A row in … can be referenced by …", left out when the cardinality is unknown. */
function parentSide(sides: Sides, cardinality: ChildCardinality): RuleNode[] {
  switch (cardinality) {
    case "many":
      return [
        sentence(sides.isSelf ? "rule.fk.self.parentMany" : "rule.fk.parentMany", args(sides)),
      ];
    case "atMostOne":
      return [sentence(sides.isSelf ? "rule.fk.self.parentOne" : "rule.fk.parentOne", args(sides))];
    case "unknown":
      return [];
  }
}

/** The text of a node the sentence builders made, which is never a group. */
function sentenceText(node: RuleNode): RuleText {
  return node.kind === "sentence" ? node.text : node.heading;
}

function nullableColumns(table: Table | undefined, names: readonly string[]): string[] {
  return names.filter(
    (name) => table?.columns.find((candidate) => candidate.name === name)?.isNullable === true,
  );
}

/** The words for a foreign key between two tables of `snapshot`. */
export function explainForeignKey(
  key: ForeignKey,
  snapshot: SchemaSnapshot,
  scope: ExplanationScope = snapshotExplanationScope(snapshot),
): ForeignKeyExplanation {
  const childEntity = entityKey(key.referencingTable);
  const parentEntity = entityKey(key.referencedTable);
  const childTable = findTable(snapshot, key.referencingTable);
  const parentTable = findTable(snapshot, key.referencedTable);
  const referencing = key.columnPairs.map((pair) => pair.referencingColumn);
  const referenced = key.columnPairs.map((pair) => pair.referencedColumn);
  const [onlyReferenced, ...otherReferenced] = referenced;
  const isSelf = childEntity === parentEntity;
  const sides: Sides = {
    child: { kind: "table", name: key.referencingTable },
    parent: { kind: "table", name: key.referencedTable },
    columns: { kind: "columns", entity: childEntity, names: referencing, join: "and" },
    parentColumns: { kind: "columns", entity: parentEntity, names: referenced, join: "and" },
    columnCount: referencing.length,
    isSelf,
    isIdentityKey:
      otherReferenced.length === 0 &&
      parentTable?.columns.find((column) => column.name === onlyReferenced)?.isIdentity === true,
    defaults: defaultsState(scope, childTable, referencing),
  };
  const optionality = foreignKeyOptionality(childTable?.columns ?? [], key);
  const childCardinality = foreignKeyChildCardinality(childTable, key);
  const onDelete = deleteSentence(sides, key.onDelete);
  const rules = [
    belongsTo(
      sides,
      optionality,
      nullableColumns(childTable, referencing),
      childEntity,
      isSelf ? "self" : "plain",
    ),
    ...parentSide(sides, childCardinality),
    onDelete,
    ...updateSentences(sides, key.onUpdate),
  ];
  const columns = new Map<string, readonly string[]>([[childEntity, referencing]]);
  columns.set(
    parentEntity,
    isSelf
      ? [...referencing, ...referenced.filter((name) => !referencing.includes(name))]
      : referenced,
  );
  return {
    optionality,
    childCardinality,
    rules: enabledRules(key.isEnabled, rules),
    deleteRule: sentenceText(onDelete),
    columns,
    sql: foreignKeyDefinitionSql(key),
  };
}

/**
 * The words for a key to a table the login cannot see: what its local columns reveal, and its
 * actions phrased against "the referenced table". The referenced side is unknown, so nothing
 * is said about it, and no SQL is scripted.
 */
export function explainForeignKeyToInvisibleTable(
  key: ForeignKeyToInvisibleTable,
  snapshot: SchemaSnapshot,
  scope: ExplanationScope = snapshotExplanationScope(snapshot),
): ForeignKeyExplanation {
  const childEntity = entityKey(key.referencingTable);
  const childTable = findTable(snapshot, key.referencingTable);
  const sides: Sides = {
    child: { kind: "table", name: key.referencingTable },
    parent: { kind: "referencedTable" },
    columns: { kind: "columns", entity: childEntity, names: key.columns, join: "and" },
    parentColumns: { kind: "referencedKey" },
    columnCount: key.columns.length,
    isSelf: false,
    isIdentityKey: false,
    defaults: defaultsState(scope, childTable, key.columns),
  };
  const optionality = foreignKeyOptionality(childTable?.columns ?? [], key);
  const onDelete = deleteSentence(sides, key.onDelete);
  const rules = [
    belongsTo(
      sides,
      optionality,
      nullableColumns(childTable, key.columns),
      childEntity,
      "invisible",
    ),
    onDelete,
    ...updateSentences(sides, key.onUpdate),
  ];
  return {
    optionality,
    childCardinality: null,
    rules: enabledRules(key.isEnabled, rules),
    deleteRule: sentenceText(onDelete),
    columns: new Map([[childEntity, key.columns]]),
    sql: null,
  };
}

interface CachedExplanations {
  scope: ExplanationScope;
  explanations: ReadonlyMap<AnyForeignKey, ForeignKeyExplanation>;
}

const explanationsBySnapshot = new WeakMap<SchemaSnapshot, CachedExplanations>();

/**
 * Whether two scopes give the same words. Kept facts compare by identity, which holds while a
 * snapshot is unchanged; two empty lists are the same whoever made them, so the canvas and the
 * Inspector, which build an empty one each, share the cached explanations.
 */
function sameScope(left: ExplanationScope, right: ExplanationScope): boolean {
  return (
    left.hasAccessProfile === right.hasAccessProfile &&
    (left.carriedOver === right.carriedOver ||
      (left.carriedOver.length === 0 && right.carriedOver.length === 0))
  );
}

/**
 * The explanation of every key of `snapshot`, both kinds, worked out once per snapshot and
 * scope: the canvas, the Inspector and the viewer ask for them on every render, and a drag or
 * a detail level change keeps the snapshot, so nothing is worked out again.
 */
export function foreignKeyExplanations(
  snapshot: SchemaSnapshot,
  scope: ExplanationScope = snapshotExplanationScope(snapshot),
): ReadonlyMap<AnyForeignKey, ForeignKeyExplanation> {
  const cached = explanationsBySnapshot.get(snapshot);
  if (cached !== undefined && sameScope(cached.scope, scope)) {
    return cached.explanations;
  }
  const explanations = new Map<AnyForeignKey, ForeignKeyExplanation>([
    ...snapshot.foreignKeys.map((key) => [key, explainForeignKey(key, snapshot, scope)] as const),
    ...(snapshot.foreignKeysToInvisibleTables ?? []).map(
      (key) => [key, explainForeignKeyToInvisibleTable(key, snapshot, scope)] as const,
    ),
  ]);
  explanationsBySnapshot.set(snapshot, { scope, explanations });
  return explanations;
}

/** The explanation of `key`: the cached one when it is a key of `snapshot`, worked out otherwise. */
export function foreignKeyExplanation(
  snapshot: SchemaSnapshot,
  key: AnyForeignKey,
  scope: ExplanationScope = snapshotExplanationScope(snapshot),
): ForeignKeyExplanation {
  return (
    foreignKeyExplanations(snapshot, scope).get(key) ??
    ("columnPairs" in key
      ? explainForeignKey(key, snapshot, scope)
      : explainForeignKeyToInvisibleTable(key, snapshot, scope))
  );
}
