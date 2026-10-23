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
import { countedSentence, sentence, stateRules } from "./ruleText";
import type { RuleArgument, RuleArguments, RuleNode, RuleState, RuleText } from "./ruleText";

/**
 * Puts a foreign key into words: which rows belong to which, how many referencing rows one
 * referenced row can have, and what deleting or changing a referenced row does. Tables are
 * named as tables ("each row in sales.Orders"), never turned into nouns, so every sentence
 * reads right in both languages whatever the tables are called. Every claim is one SQL Server
 * makes good on when values are written, as far as the snapshot can tell (see
 * {@link ChildCardinality} for what a file saved before 1.2 does not record), and the
 * integration tests pin the engine facts the sentences rest on: a disabled key checks nothing, a
 * key added WITH NOCHECK still checks every row inserted after and every row whose referencing
 * columns are written, a row with a NULL in any column of the key is not checked, NO ACTION is
 * checked once the statement has run, an identity column cannot be updated, SET DEFAULT falls
 * back to NULL, and a disabled nonclustered or filtered unique index does not keep a referenced
 * row to one referencing row.
 */

/**
 * Whether a referencing row must point to a referenced row: `required` when every referencing
 * column is NOT NULL, `optional` when any accepts NULL (SQL Server checks a composite key only
 * when all its columns have a value), `unknown` when the columns are not all known.
 */
export type ForeignKeyOptionality = "required" | "optional" | "unknown";

/**
 * How many referencing rows one referenced row can have, judged from the primary key, the unique
 * constraints and the unique indexes of the referencing table that lie within the key's columns:
 *
 * - `atMostOne` when one of them holds: the primary key or a unique constraint not recorded as
 *   disabled, a unique index recorded as enabled and without a filter, or a disabled clustered
 *   one of any of them, since SQL Server then keeps every key of its table disabled until the
 *   index is rebuilt, which makes it unique again;
 * - `unknown` when none holds but a unique index has a filter, which limits only the rows it
 *   selects, or a state a file saved before 1.2 did not record;
 * - `many` otherwise, every one of them disabled included: a disabled nonclustered index limits
 *   nothing.
 *
 * A primary key or a unique constraint whose state was not recorded keeps the reading of 1.1,
 * `atMostOne`, until a refresh records it, while a unique index whose state was not recorded
 * stays `unknown`.
 */
export type ChildCardinality = "many" | "atMostOne" | "unknown";

/**
 * The cardinality of a key with the indexes behind it that do not hold: the disabled ones, which
 * make it `many` when no other holds, and the filtered unique indexes, which make it `unknown`.
 */
export interface ChildCardinalityReading {
  cardinality: ChildCardinality;
  /**
   * Nonclustered primary key, unique constraints and unique indexes within the key that are
   * disabled. A disabled clustered one holds and is not named.
   */
  disabled: readonly string[];
  /** Enabled unique indexes within the key that have a filter. */
  filtered: readonly string[];
}

export interface ForeignKeyExplanation {
  /** Native PostgreSQL facts use catalog DDL rather than SQL Server enforcement prose. */
  native?: true;
  optionality: ForeignKeyOptionality;
  /** `null` for a key to a table the login cannot see, whose referenced side is unknown. */
  childCardinality: ChildCardinality | null;
  /**
   * The sentences in order: under "When enabled:" for a disabled key, and, for an enabled key
   * SQL Server marks as not trusted, after the sentence that says so, the one about the
   * referencing rows under the heading for the rows inserted, or whose referencing columns are
   * changed, from now on, and the ones about the referenced table after it.
   */
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
  restrict: "RESTRICT",
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

/** Whether a unique index or key behind a key holds, as far as the snapshot recorded its state. */
type Enforcement = "holds" | "disabled" | "filtered" | "notRecorded";

/**
 * Whether `index` keeps rows unique. A primary key or a unique constraint not recorded as
 * disabled holds, as 1.1 read every one of them; a unique index holds only when it is recorded
 * as enabled and without a filter; and a disabled one of any of them holds only when it is
 * clustered.
 */
function enforcement(
  index: { isEnabled?: boolean; isFiltered?: boolean; isClustered: boolean },
  isConstraint: boolean,
): Enforcement {
  if (index.isEnabled === false) {
    // A disabled clustered index takes no row, and SQL Server keeps every foreign key of its
    // table disabled, refusing to enable one, until the index is rebuilt, which makes it unique
    // again: by the time the key can be enabled, the index holds.
    return index.isClustered ? "holds" : "disabled";
  }
  if (index.isFiltered === true) {
    return "filtered";
  }
  if (isConstraint) {
    return "holds";
  }
  return index.isEnabled === true && index.isFiltered === false ? "holds" : "notRecorded";
}

/** How many rows of `referencingTable` one referenced row can have through `key`, and why. */
export function foreignKeyChildCardinalityReading(
  referencingTable: Table | undefined,
  key: AnyForeignKey,
): ChildCardinalityReading {
  if (referencingTable === undefined) {
    return { cardinality: "unknown", disabled: [], filtered: [] };
  }
  const keyColumns = new Set(referencingColumnNames(key));
  const within = (columns: readonly string[]) =>
    columns.length > 0 && columns.every((column) => keyColumns.has(column));
  const { primaryKey, indexes } = referencingTable;
  const candidates = [
    ...(primaryKey !== null && within(primaryKey.columns)
      ? [{ name: primaryKey.name, state: enforcement(primaryKey, true) }]
      : []),
    ...indexes
      .filter((index) => index.kind !== "nonUnique" && within(index.columns))
      .map((index) => ({
        name: index.name,
        state: enforcement(index, index.kind === "uniqueConstraint"),
      })),
  ];
  const named = (state: Enforcement) =>
    candidates.filter((candidate) => candidate.state === state).map((candidate) => candidate.name);
  const disabled = named("disabled");
  const filtered = named("filtered");
  if (candidates.some((candidate) => candidate.state === "holds")) {
    return { cardinality: "atMostOne", disabled, filtered };
  }
  const isUnknown = candidates.some(
    (candidate) => candidate.state === "filtered" || candidate.state === "notRecorded",
  );
  return { cardinality: isUnknown ? "unknown" : "many", disabled, filtered };
}

/** How many rows of `referencingTable` one referenced row can have through `key`. */
export function foreignKeyChildCardinality(
  referencingTable: Table | undefined,
  key: AnyForeignKey,
): ChildCardinality {
  return foreignKeyChildCardinalityReading(referencingTable, key).cardinality;
}

/**
 * The key as an `ALTER TABLE … ADD CONSTRAINT` statement, scripted from the catalog: ON DELETE
 * and ON UPDATE only when they are not NO ACTION. A disabled key is added `WITH NOCHECK`, as
 * the rows it let in may not follow it, and then disabled with a NOCHECK statement. An enabled
 * key SQL Server marks as not trusted is added `WITH NOCHECK` and left enabled, which recreates
 * it enabled and not trusted. 1.2 does not record NOT FOR REPLICATION, so a key that has it is
 * scripted without it. Names are bracketed with closing brackets doubled.
 */
export function foreignKeyDefinitionSql(key: ForeignKey): string {
  const table = (name: QualifiedName) =>
    `${quoteIdentifier(name.schema)}.${quoteIdentifier(name.name)}`;
  const list = (names: readonly string[]) => names.map(quoteIdentifier).join(", ");
  const referencing = list(key.columnPairs.map((pair) => pair.referencingColumn));
  const referenced = list(key.columnPairs.map((pair) => pair.referencedColumn));
  const check = key.isEnabled && key.isTrusted !== false ? "" : " WITH NOCHECK";
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
    restrict: "rule.fk.native.delete",
    noAction: sides.isSelf ? "rule.fk.self.delete.noAction" : "rule.fk.delete.noAction",
    cascade: "rule.fk.delete.cascade",
    setNull: "rule.fk.delete.setNull",
  };
  return action === "setDefault"
    ? setDefaultSentence(sides, "delete")
    : sentence(
        keys[action],
        args(sides, { action: { kind: "keyword", text: ACTION_SQL[action] } }),
      );
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
    case "restrict":
      return [
        sentence("rule.fk.native.update", {
          action: { kind: "keyword", text: ACTION_SQL[action] },
        }),
      ];
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

/**
 * "A row in … can be referenced by …": by any number, naming the disabled indexes when they are
 * why; by at most one; or, when no index holds but a unique index has a filter, by at most one of
 * the rows each filter selects, which says nothing of the other rows. Left out when the
 * cardinality is unknown for a state the file did not record.
 */
function parentSide(sides: Sides, reading: ChildCardinalityReading): RuleNode[] {
  const { cardinality, disabled, filtered } = reading;
  switch (cardinality) {
    case "many":
      return disabled.length === 0
        ? [sentence(sides.isSelf ? "rule.fk.self.parentMany" : "rule.fk.parentMany", args(sides))]
        : [
            countedSentence(
              sides.isSelf ? "rule.fk.self.parentManyDisabled" : "rule.fk.parentManyDisabled",
              disabled.length,
              args(sides, { indexes: { kind: "names", names: disabled, join: "and" } }),
            ),
          ];
    case "atMostOne":
      return [sentence(sides.isSelf ? "rule.fk.self.parentOne" : "rule.fk.parentOne", args(sides))];
    case "unknown":
      return filtered.map((name) =>
        sentence(
          sides.isSelf ? "rule.fk.self.parentFiltered" : "rule.fk.parentFiltered",
          args(sides, { index: { kind: "names", names: [name], join: "and" } }),
        ),
      );
  }
}

/** What SQL Server enforces of `key`, for its sentences to say. */
function keyState(key: AnyForeignKey): RuleState {
  return {
    rule: "foreignKey",
    table: key.referencingTable,
    isEnabled: key.isEnabled,
    isTrusted: key.isTrusted ?? null,
  };
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
  if (snapshot.provider === "postgreSql") return explainPostgreSqlForeignKey(key, snapshot);
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
  const cardinality = foreignKeyChildCardinalityReading(childTable, key);
  const onDelete = deleteSentence(sides, key.onDelete);
  // Only the referencing rows depend on trust; what a referenced row allows and what deleting or
  // changing one does hold for every row.
  const rules = stateRules(
    keyState(key),
    [
      belongsTo(
        sides,
        optionality,
        nullableColumns(childTable, referencing),
        childEntity,
        isSelf ? "self" : "plain",
      ),
    ],
    referencing,
    [...parentSide(sides, cardinality), onDelete, ...updateSentences(sides, key.onUpdate)],
  );
  const columns = new Map<string, readonly string[]>([[childEntity, referencing]]);
  columns.set(
    parentEntity,
    isSelf
      ? [...referencing, ...referenced.filter((name) => !referencing.includes(name))]
      : referenced,
  );
  return {
    optionality,
    childCardinality: cardinality.cardinality,
    rules,
    deleteRule: sentenceText(onDelete),
    columns,
    sql: foreignKeyDefinitionSql(key),
  };
}

/** Native MATCH rules and usable unique indexes; no SQL Server state is inferred. */
function explainPostgreSqlForeignKey(
  key: ForeignKey,
  snapshot: SchemaSnapshot,
): ForeignKeyExplanation {
  const child = entityKey(key.referencingTable);
  const parent = entityKey(key.referencedTable);
  const names = key.columnPairs.map((pair) => pair.referencingColumn);
  const columns = findTable(snapshot, key.referencingTable)?.columns ?? [];
  const known = names.map((name) => columns.find((column) => column.name === name));
  const native = snapshot.postgresql?.constraints.find(
    (constraint) =>
      entityKey(constraint.table) === child &&
      constraint.name === key.name &&
      constraint.kind === "foreignKey",
  );
  const optionality: ForeignKeyOptionality =
    known.some((column) => column === undefined) || native === undefined
      ? "unknown"
      : native.matchType === "full"
        ? known.every((column) => column?.isNullable === true)
          ? "optional"
          : "required"
        : native.matchType === "simple"
          ? known.some((column) => column?.isNullable === true)
            ? "optional"
            : "required"
          : "unknown";
  const indexes =
    snapshot.postgresql?.indexes.filter((index) => entityKey(index.table) === child) ?? [];
  const cardinality: ChildCardinality =
    snapshot.postgresql === undefined
      ? "unknown"
      : indexes.some(
            (index) =>
              index.isUnique &&
              index.isValid &&
              index.isReady &&
              index.isLive &&
              index.predicate === null &&
              index.keyColumns.length > 0 &&
              index.keyColumns.every((column) => column !== null && names.includes(column)),
          )
        ? "atMostOne"
        : "many";
  const targets = new Map<string, readonly string[]>([[child, names]]);
  const referenced = key.columnPairs.map((pair) => pair.referencedColumn);
  targets.set(parent, child === parent ? [...new Set([...names, ...referenced])] : referenced);
  const deletion = sentence("rule.fk.native.delete", {
    action: { kind: "keyword", text: ACTION_SQL[key.onDelete] },
  });
  return {
    native: true,
    optionality,
    childCardinality: cardinality,
    rules: [
      deletion,
      sentence("rule.fk.native.update", {
        action: { kind: "keyword", text: ACTION_SQL[key.onUpdate] },
      }),
    ],
    deleteRule: sentenceText(deletion),
    columns: targets,
    sql: native === undefined ? null : definitionText(native.definition),
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
  const rules = stateRules(
    keyState(key),
    [
      belongsTo(
        sides,
        optionality,
        nullableColumns(childTable, key.columns),
        childEntity,
        "invisible",
      ),
    ],
    key.columns,
    [onDelete, ...updateSentences(sides, key.onUpdate)],
  );
  return {
    optionality,
    childCardinality: null,
    rules,
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
