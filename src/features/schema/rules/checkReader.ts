import type { CheckConstraint, Column, QualifiedName } from "@/shared/contracts";
import type { RuleMessageKey } from "@/shared/i18n/messages/rules/en";

import { definitionText, isUnknownDefinition } from "../definition";
import { entityKey } from "../entities";
import { parseCheck } from "./checkParser";
import type { CheckExpression, ComparisonOperator } from "./checkParser";
import { referencedColumns, resolveColumn, tokenizeCheck } from "./checkTokens";
import {
  anyOfGroup,
  countedSentence,
  sentence,
  stateRules,
  untrustedRules,
  whenPresentGroup,
} from "./ruleText";
import type { RuleArgument, RuleArguments, RuleNode, RuleState } from "./ruleText";

/**
 * Puts a `CHECK` constraint into words, from the text SQL Server stores for it. The reader
 * knows a closed set of forms (comparisons, ranges, lists of values, NULL tests, LIKE shapes,
 * lengths and sizes, AND lists and the ORs that are safe to word) and reads all or nothing:
 * when any part is outside that set, or a name is not a column of the table, it reads none of
 * it and the stored SQL is shown instead. A wrong sentence is worse than none, so:
 *
 * - a CHECK accepts a row whose expression is unknown, so a rule over a nullable column sits
 *   under "When … has a value:", and an OR with a branch that can be unknown is not read;
 * - a comparison with a NULL literal, which is always unknown, is not read;
 * - text comparisons carry the collation note, and comparisons whose meaning depends on the
 *   session (a `'YYYY-MM-DD'` datetime) or on how values convert are not read;
 * - the time now is "when the value is saved": SQL Server checks a CHECK only when a statement
 *   writes one of its columns;
 * - a CHECK SQL Server marks as not trusted says so, and its rules then hold for the rows
 *   inserted, and for those whose columns it reads are changed, from now on.
 */

/** A note a reading needs under its sentences. */
export type RuleNote = "pattern" | "collation";

export type CheckReading =
  /** Read in full: the rules in order, the columns they mention, and the notes they need. */
  | {
      status: "read";
      rules: readonly RuleNode[];
      columns: readonly string[];
      notes: ReadonlySet<RuleNote>;
      sql: string;
    }
  /**
   * Not put into words; the stored SQL is shown, and the columns it mentions highlighted.
   * `rules` holds what is still known in words: that the rows already there may not follow it.
   */
  | { status: "unread"; rules: readonly RuleNode[]; columns: readonly string[]; sql: string }
  /** The constraint exists but its text is not visible to the login; `rules` as for `unread`. */
  | { status: "notAvailable"; rules: readonly RuleNode[] }
  /** A SchemaCraft 1.0 file did not record the text; `rules` as for `unread`. */
  | { status: "notRecorded"; rules: readonly RuleNode[] };

type Family = "number" | "text" | "date" | "time" | "binary";

const FAMILIES: Readonly<Partial<Record<string, Family>>> = {
  tinyint: "number",
  smallint: "number",
  int: "number",
  bigint: "number",
  decimal: "number",
  numeric: "number",
  money: "number",
  smallmoney: "number",
  float: "number",
  real: "number",
  bit: "number",
  char: "text",
  varchar: "text",
  nchar: "text",
  nvarchar: "text",
  date: "date",
  datetime: "date",
  datetime2: "date",
  smalldatetime: "date",
  datetimeoffset: "date",
  time: "time",
  binary: "binary",
  varbinary: "binary",
};

function familyOf(column: Column): Family | undefined {
  return FAMILIES[column.dataType.name];
}

function isTemporal(family: Family | undefined): boolean {
  return family === "date" || family === "time";
}

/** Text types whose values SQL Server pads with spaces to their declared length. */
const FIXED_LENGTH_TEXT = new Set(["char", "nchar"]);
/** Text types that make LIKE match as Unicode, where trailing spaces of the value count. */
const UNICODE_TEXT = new Set(["nchar", "nvarchar"]);

const LOCAL_NOW = new Set(["getdate", "sysdatetime", "current_timestamp"]);
const UTC_NOW = new Set(["getutcdate", "sysutcdatetime"]);
const OFFSET_NOW = "sysdatetimeoffset";
const TRIMS = new Set(["trim", "ltrim", "rtrim"]);
/** Types a comparison with `getdate()` and its kin compares as wall-clock values. */
const NOW_TYPES = new Set(["datetime", "datetime2", "smalldatetime"]);

const INTEGER = /^-?\d+$/u;
const EXPONENT = /e/iu;
const WILDCARD = /[%_[]/u;
const DATE_ONLY = /^(?:\d{4}-\d{2}-\d{2}|\d{8})$/u;
const DATETIME2 = /^(?:\d{4}-\d{2}-\d{2}|\d{8})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.(\d{1,7}))?)?)?$/u;
const DATETIME =
  /^(?:\d{8}(?: \d{2}:\d{2}(?::\d{2})?)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)$/u;
const SMALLDATETIME = /^(?:\d{8}(?: \d{2}:\d{2})?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/u;
const TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.(\d{1,7}))?)?$/u;

/** A value in a comparison, once its parts are known to be ones the reader words. */
type Operand =
  | { kind: "column"; column: Column }
  /** `len(c)`, `datalength(c)`, or `c` with its spaces trimmed. */
  | { kind: "measure"; measure: "length" | "bytes" | "trimmed"; column: Column }
  | { kind: "number"; text: string }
  | { kind: "string"; value: string }
  /** The time the value is saved; `offset` for `sysdatetimeoffset()`. */
  | { kind: "now"; utc: boolean; offset: boolean };

type Subject = Extract<Operand, { kind: "column" | "measure" }>;

type Measure = Extract<Operand, { kind: "measure" }>;

/** A lower or upper bound, which pairs with the opposite one on the same subject into a range. */
interface Bound {
  measure: "value" | "length" | "bytes";
  column: Column;
  operator: ">=" | "<=";
  /** The bound as SQL writes it, e.g. `5` or `'2000-01-01'`. */
  text: string;
  /** What orders two bounds: a number, or a date text in one of the accepted formats. */
  order: number | string;
}

/** A value a column must differ from; several on one column read as one list. */
interface Exclusion {
  column: Column;
  text: string;
}

/** A sentence or group, with the nullable columns whose NULL makes its test unknown. */
interface Reading {
  node: RuleNode;
  needs: readonly Column[];
  bound?: Bound;
  exclusion?: Exclusion;
}

interface Context {
  columns: readonly Column[];
  entity: string;
  notes: Set<RuleNote>;
}

const VALUE_KEYS: Readonly<Record<ComparisonOperator, RuleMessageKey>> = {
  "=": "rule.check.eq",
  "<>": "rule.check.ne",
  ">": "rule.check.gt",
  ">=": "rule.check.ge",
  "<": "rule.check.lt",
  "<=": "rule.check.le",
};

const DATE_KEYS: Readonly<Record<ComparisonOperator, RuleMessageKey>> = {
  "=": "rule.check.eq",
  "<>": "rule.check.ne",
  ">": "rule.check.after",
  ">=": "rule.check.onOrAfter",
  "<": "rule.check.before",
  "<=": "rule.check.onOrBefore",
};

const FLIPPED: Readonly<Record<ComparisonOperator, ComparisonOperator>> = {
  "=": "=",
  "<>": "<>",
  "<": ">",
  ">": "<",
  "<=": ">=",
  ">=": "<=",
};

/** `'it''s'`: a text as SQL writes it. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function literalArgument(text: string): RuleArgument {
  return { kind: "literal", text };
}

function columnArguments(context: Context, column: Column): RuleArguments {
  return { column: { kind: "column", entity: context.entity, name: column.name } };
}

/** The nullable columns among `columns` that no guard has shown to have a value, each once. */
function needsOf(columns: readonly Column[], guarded: ReadonlySet<string>): Column[] {
  const needs: Column[] = [];
  for (const column of columns) {
    if (column.isNullable && !guarded.has(column.name) && !needs.includes(column)) {
      needs.push(column);
    }
  }
  return needs;
}

function classify(context: Context, expression: CheckExpression | undefined): Operand | null {
  switch (expression?.kind) {
    case "column": {
      const column = resolveColumn(expression.name, context.columns);
      return column === undefined ? null : { kind: "column", column };
    }
    case "number":
      // A float literal is stored in exponent notation, which the reader does not reformat.
      return EXPONENT.test(expression.text) ? null : { kind: "number", text: expression.text };
    case "string":
      return { kind: "string", value: expression.value };
    case "call":
      return classifyCall(context, expression);
    case "and":
    case "or":
    case "not":
    case "compare":
    case "isNull":
    case "like":
    case "between":
    case "in":
    case "null":
    case "arithmetic":
    case "unary":
    case undefined:
      return null;
  }
}

/** The built-in functions the reader words; a user-defined function is never one of them. */
function classifyCall(
  context: Context,
  call: Extract<CheckExpression, { kind: "call" }>,
): Operand | null {
  if (call.schema !== null || call.isQuoted) {
    return null;
  }
  const name = call.name.toLowerCase();
  const [argument, ...rest] = call.arguments;
  if (argument === undefined) {
    return LOCAL_NOW.has(name) || UTC_NOW.has(name) || name === OFFSET_NOW
      ? { kind: "now", utc: UTC_NOW.has(name), offset: name === OFFSET_NOW }
      : null;
  }
  if (rest.length > 0) {
    return null;
  }
  const inner = classify(context, argument);
  if (name === "len" || name === "datalength") {
    return inner?.kind === "column"
      ? { kind: "measure", measure: name === "len" ? "length" : "bytes", column: inner.column }
      : null;
  }
  if (
    TRIMS.has(name) &&
    (inner?.kind === "column" || (inner?.kind === "measure" && inner.measure === "trimmed"))
  ) {
    return { kind: "measure", measure: "trimmed", column: inner.column };
  }
  return null;
}

/** Whether the fraction of seconds in a time literal fits the column, which would round it otherwise. */
function fitsPrecision(fraction: string | undefined, column: Column): boolean {
  return fraction === undefined || fraction.length <= (column.dataType.precision ?? 7);
}

/**
 * A date without a time, against a type with one, means midnight: "on or after '2000-01-01'"
 * and "before '2000-01-01'" say that, while "on or before '2000-12-31'" would wrongly take in
 * the rest of that day, and "equal to" every moment of it.
 */
function readsAsMidnight(value: string, operator: ComparisonOperator): boolean {
  return !DATE_ONLY.test(value) || operator === ">=" || operator === "<";
}

/**
 * A literal compared with `column` with `operator`, as SQL writes it, or `null` when the
 * comparison would not mean what its words say: a value of another type, which SQL Server
 * converts, or a date text whose meaning depends on the session or on a time it leaves out.
 */
function literalText(column: Column, value: Operand, operator: ComparisonOperator): string | null {
  const family = familyOf(column);
  if (value.kind === "number") {
    return family === "number" ? value.text : null;
  }
  if (value.kind !== "string") {
    return null;
  }
  const text = value.value;
  const type: string = isTemporal(family) ? column.dataType.name : (family ?? "");
  const accepted = (() => {
    switch (type) {
      case "text":
        return true;
      case "date":
        return DATE_ONLY.test(text);
      case "datetime2": {
        const match = DATETIME2.exec(text);
        return match !== null && fitsPrecision(match[1], column) && readsAsMidnight(text, operator);
      }
      case "datetime":
        // Only the formats SQL Server reads the same under every DATEFORMAT and language.
        return DATETIME.test(text) && readsAsMidnight(text, operator);
      case "smalldatetime":
        return SMALLDATETIME.test(text) && readsAsMidnight(text, operator);
      case "time": {
        const match = TIME.exec(text);
        return match !== null && fitsPrecision(match[1], column);
      }
      default:
        // datetimeoffset compares instants, so a text without an offset is not the date it reads as.
        return false;
    }
  })();
  return accepted ? quote(text) : null;
}

function readCompare(
  context: Context,
  compare: Extract<CheckExpression, { kind: "compare" }>,
  guarded: ReadonlySet<string>,
): Reading | null {
  const left = classify(context, compare.left);
  const right = classify(context, compare.right);
  if (left === null || right === null) {
    return null;
  }
  if (left.kind === "column" || left.kind === "measure") {
    return readComparison(context, left, compare.operator, right, guarded);
  }
  if (right.kind === "column" || right.kind === "measure") {
    // A literal written first is flipped, so the column always leads the sentence.
    return readComparison(context, right, FLIPPED[compare.operator], left, guarded);
  }
  return null;
}

function readComparison(
  context: Context,
  subject: Subject,
  operator: ComparisonOperator,
  value: Operand,
  guarded: ReadonlySet<string>,
): Reading | null {
  if (subject.kind === "measure") {
    return readMeasure(context, subject, operator, value, guarded);
  }
  const { column } = subject;
  const family = familyOf(column);
  if (family === undefined || family === "binary") {
    return null;
  }
  const isText = family === "text";
  if (isText && operator !== "=" && operator !== "<>") {
    // The order of texts follows the collation, which "greater than" would not convey.
    return null;
  }
  const key = (isTemporal(family) ? DATE_KEYS : VALUE_KEYS)[operator];
  switch (value.kind) {
    case "column": {
      const other = value.column;
      const sameFamily =
        familyOf(other) === family &&
        (!isTemporal(family) || other.dataType.name === column.dataType.name);
      if (!sameFamily) {
        return null;
      }
      if (isText) {
        context.notes.add("collation");
      }
      return {
        node: sentence(key, {
          ...columnArguments(context, column),
          value: { kind: "column", entity: context.entity, name: other.name },
        }),
        needs: needsOf([column, other], guarded),
      };
    }
    case "now": {
      const type = column.dataType.name;
      if (value.offset ? type !== "datetimeoffset" : !NOW_TYPES.has(type)) {
        return null;
      }
      return {
        node: sentence(key, {
          ...columnArguments(context, column),
          value: { kind: "now", utc: value.utc },
        }),
        needs: needsOf([column], guarded),
      };
    }
    case "number":
    case "string": {
      if (isText && value.kind === "string" && value.value === "") {
        // SQL Server ignores trailing spaces, so `<> ''` also refuses a text of spaces only.
        if (operator !== "<>") {
          return null;
        }
        context.notes.add("collation");
        return {
          node: sentence("rule.check.notBlank", columnArguments(context, column)),
          needs: needsOf([column], guarded),
        };
      }
      const text = literalText(column, value, operator);
      if (text === null) {
        return null;
      }
      if (isText) {
        context.notes.add("collation");
      }
      const reading: Reading = {
        node: sentence(key, { ...columnArguments(context, column), value: literalArgument(text) }),
        needs: needsOf([column], guarded),
      };
      if (operator === ">=" || operator === "<=") {
        const order = value.kind === "number" ? Number(value.text) : value.value;
        reading.bound = { measure: "value", column, operator, text, order };
      }
      if (operator === "<>") {
        reading.exclusion = { column, text };
      }
      return reading;
    }
    case "measure":
      return null;
  }
}

/** What a length or size limit says once its edge cases are folded in. */
type MeasureFact =
  | { kind: "exactly" | "atLeast" | "atMost"; count: number }
  /** At least one character other than a trailing space, or at least one byte. */
  | { kind: "present" };

function measureFact(operator: ComparisonOperator, limit: number): MeasureFact | null {
  switch (operator) {
    case "=":
      return limit >= 0 ? { kind: "exactly", count: limit } : null;
    case ">":
      if (limit === 0) {
        return { kind: "present" };
      }
      return limit > 0 ? { kind: "atLeast", count: limit + 1 } : null;
    case ">=":
      if (limit === 1) {
        return { kind: "present" };
      }
      return limit > 1 ? { kind: "atLeast", count: limit } : null;
    case "<":
      return limit > 1 ? { kind: "atMost", count: limit - 1 } : null;
    case "<=":
      return limit > 0 ? { kind: "atMost", count: limit } : null;
    case "<>":
      return limit === 0 ? { kind: "present" } : null;
  }
}

function readMeasure(
  context: Context,
  subject: Measure,
  operator: ComparisonOperator,
  value: Operand,
  guarded: ReadonlySet<string>,
): Reading | null {
  const { column, measure } = subject;
  const family = familyOf(column);
  const needs = needsOf([column], guarded);
  const args = columnArguments(context, column);
  if (measure === "trimmed") {
    if (operator !== "<>" || value.kind !== "string" || value.value !== "" || family !== "text") {
      return null;
    }
    context.notes.add("collation");
    return { node: sentence("rule.check.notBlank", args), needs };
  }
  // LEN counts the characters of a text; DATALENGTH the bytes of a text or a binary value.
  const measurable =
    measure === "length" ? family === "text" : family === "text" || family === "binary";
  if (!measurable || value.kind !== "number" || !INTEGER.test(value.text)) {
    return null;
  }
  const limit = Number(value.text);
  const fact = Number.isSafeInteger(limit) ? measureFact(operator, limit) : null;
  if (fact === null) {
    return null;
  }
  const reading: Reading = {
    node:
      fact.kind === "present"
        ? sentence(measure === "length" ? "rule.check.notBlank" : "rule.check.notEmpty", args)
        : countedSentence(`rule.check.${measure}.${fact.kind}`, fact.count, args),
    needs,
  };
  if (operator !== "=" && operator !== "<>") {
    // Lengths and sizes are whole numbers, so `> 1` is the bound `>= 2` and `< 11` is `<= 10`.
    const isLower = operator === ">" || operator === ">=";
    const order = limit + (operator === ">" ? 1 : 0) - (operator === "<" ? 1 : 0);
    reading.bound = {
      measure,
      column,
      operator: isLower ? ">=" : "<=",
      text: String(order),
      order,
    };
  }
  return reading;
}

/**
 * The text between `start` and `end` in a LIKE pattern when it holds no wildcard and does not
 * begin or end with a space, whose comparison SQL Server treats apart; `null` otherwise.
 */
function plainPart(pattern: string, start: string, end: string): string | null {
  if (!pattern.startsWith(start) || !pattern.endsWith(end)) {
    return null;
  }
  const inner = pattern.slice(start.length, pattern.length - end.length);
  return inner !== "" && !WILDCARD.test(inner) && inner.trim() === inner ? inner : null;
}

/**
 * Puts a LIKE into words. How SQL Server treats trailing spaces of the value decides the
 * wording, as pinned against the engine: a char or varchar value matched against a plain
 * pattern also matches once trailing spaces are dropped, so a suffix is read "not counting
 * trailing spaces"; when the column or the pattern is Unicode (nchar, nvarchar, `N'…'`) every
 * space counts. A space can also be one of the characters a pattern refuses, so digits only
 * says nothing about trailing spaces.
 *
 * char and nchar pad a shorter value with spaces up to their length, and LIKE sees them. A
 * prefix, a text contained and a suffix outside Unicode read the same as on varchar, since the
 * padding comes after the value and is either taken by the closing `%` or need not match. The
 * rest is not read on these types: a Unicode suffix refuses every value shorter than the
 * column, any other pattern can match a padding space with `_` (`'A'` passes `LIKE 'A_'` on
 * char(5)) or fail on it in Unicode, and digits only would refuse an empty value it says is
 * accepted.
 */
function readLike(
  context: Context,
  like: Extract<CheckExpression, { kind: "like" }>,
  negated: boolean,
  guarded: ReadonlySet<string>,
): Reading | null {
  const subject = classify(context, like.operand);
  if (
    like.escape !== null ||
    subject?.kind !== "column" ||
    familyOf(subject.column) !== "text" ||
    like.pattern.kind !== "string"
  ) {
    return null;
  }
  const { column } = subject;
  const pattern = like.pattern.value;
  const type = column.dataType.name;
  const isUnicode = like.pattern.isUnicode || UNICODE_TEXT.has(type);
  const isPadded = FIXED_LENGTH_TEXT.has(type);
  const read = (key: RuleMessageKey, args: RuleArguments = {}): Reading => ({
    node: sentence(key, { ...columnArguments(context, column), ...args }),
    needs: needsOf([column], guarded),
  });
  const quoted = (text: string): RuleArguments => ({ value: literalArgument(quote(text)) });
  context.notes.add("collation");
  const contained = plainPart(pattern, "%", "%");
  if (negated) {
    if (contained !== null) {
      return read("rule.check.notContains", quoted(contained));
    }
    if (isPadded) {
      return null;
    }
    if (pattern === "%[^0-9]%") {
      return read("rule.check.onlyDigits");
    }
    context.notes.add("pattern");
    return read("rule.check.notMatches", { pattern: literalArgument(quote(pattern)) });
  }
  const prefix = plainPart(pattern, "", "%");
  if (prefix !== null) {
    return read("rule.check.startsWith", quoted(prefix));
  }
  const suffix = plainPart(pattern, "%", "");
  if (suffix !== null) {
    if (!isUnicode) {
      return read("rule.check.endsWith", quoted(suffix));
    }
    return isPadded ? null : read("rule.check.endsWithExactly", quoted(suffix));
  }
  if (contained !== null) {
    return read("rule.check.contains", quoted(contained));
  }
  if (isPadded) {
    return null;
  }
  context.notes.add("pattern");
  return read("rule.check.matches", { pattern: literalArgument(quote(pattern)) });
}

/** A column equal to, or different from, each of `values`: one sentence for one value, a list otherwise. */
function listReading(
  context: Context,
  column: Column,
  values: readonly Operand[],
  negated: boolean,
  guarded: ReadonlySet<string>,
): Reading | null {
  const operator = negated ? "<>" : "=";
  const texts: string[] = [];
  for (const value of values) {
    const text = literalText(column, value, operator);
    if (text === null) {
      return null;
    }
    if (!texts.includes(text)) {
      texts.push(text);
    }
  }
  const [only, ...others] = texts;
  if (only === undefined) {
    return null;
  }
  if (familyOf(column) === "text") {
    context.notes.add("collation");
  }
  const needs = needsOf([column], guarded);
  const args = columnArguments(context, column);
  if (others.length > 0) {
    return {
      node: sentence(negated ? "rule.check.noneOf" : "rule.check.oneOf", {
        ...args,
        values: { kind: "literals", texts, join: negated ? "and" : "or" },
      }),
      needs,
    };
  }
  const reading: Reading = {
    node: sentence(VALUE_KEYS[operator], { ...args, value: literalArgument(only) }),
    needs,
  };
  if (negated) {
    reading.exclusion = { column, text: only };
  }
  return reading;
}

/**
 * The column and values of an OR chain of equalities between one column and literals, which
 * is how SQL Server stores `IN`; `null` for any other chain.
 */
function equalityList(
  context: Context,
  operands: readonly CheckExpression[],
): { column: Column; values: Operand[] } | null {
  let column: Column | undefined;
  const values: Operand[] = [];
  for (const operand of operands) {
    if (operand.kind !== "compare" || operand.operator !== "=") {
      return null;
    }
    const left = classify(context, operand.left);
    const right = classify(context, operand.right);
    const [subject, value] = left?.kind === "column" ? [left, right] : [right, left];
    if (subject?.kind !== "column" || (value?.kind !== "number" && value?.kind !== "string")) {
      return null;
    }
    if (column !== undefined && column !== subject.column) {
      return null;
    }
    column = subject.column;
    values.push(value);
  }
  return column === undefined ? null : { column, values };
}

function single(reading: Reading | null): Reading[] | null {
  return reading === null ? null : [reading];
}

function readIsNull(context: Context, operand: CheckExpression, negated: boolean): Reading | null {
  const subject = classify(context, operand);
  if (subject?.kind !== "column") {
    return null;
  }
  // A NULL test is never unknown, so it needs no column to have a value.
  return {
    node: sentence(
      negated ? "rule.check.required" : "rule.check.null",
      columnArguments(context, subject.column),
    ),
    needs: [],
  };
}

function readIn(
  context: Context,
  list: Extract<CheckExpression, { kind: "in" }>,
  negated: boolean,
  guarded: ReadonlySet<string>,
): Reading | null {
  const subject = classify(context, list.operand);
  if (subject?.kind !== "column") {
    return null;
  }
  const values: Operand[] = [];
  for (const value of list.values) {
    const operand = classify(context, value);
    if (operand === null) {
      return null;
    }
    values.push(operand);
  }
  return listReading(context, subject.column, values, negated, guarded);
}

function readNot(
  context: Context,
  operand: CheckExpression,
  guarded: ReadonlySet<string>,
): Reading[] | null {
  switch (operand.kind) {
    case "like":
      return single(readLike(context, operand, !operand.negated, guarded));
    case "isNull":
      return single(readIsNull(context, operand.operand, !operand.negated));
    case "in":
      return single(readIn(context, operand, !operand.negated, guarded));
    case "compare":
    case "or": {
      // NOT IN, stored as NOT over the OR chain of its values, reversed. NOT over any other
      // comparison or group is outside the forms the reader words.
      const list = equalityList(context, operand.kind === "or" ? operand.operands : [operand]);
      return list === null
        ? null
        : single(listReading(context, list.column, list.values.toReversed(), true, guarded));
    }
    case "and":
    case "not":
    case "between":
    case "column":
    case "number":
    case "string":
    case "null":
    case "call":
    case "arithmetic":
    case "unary":
      return null;
  }
}

function readBetween(
  context: Context,
  between: Extract<CheckExpression, { kind: "between" }>,
  guarded: ReadonlySet<string>,
): Reading[] | null {
  if (between.negated) {
    return null;
  }
  const bounds: Reading[] = [];
  for (const [operator, bound] of [
    [">=", between.low],
    ["<=", between.high],
  ] as const) {
    const reading = readCompare(
      context,
      { kind: "compare", operator, left: between.operand, right: bound },
      guarded,
    );
    if (reading === null) {
      return null;
    }
    bounds.push(reading);
  }
  const merged = mergeReadings(context, bounds);
  // Bounds the wrong way round make no range, and are not worded.
  return merged.length === 1 ? merged : null;
}

/** An alternative of an OR, read on its own: one sentence, which no NULL can make unknown. */
function alternative(
  context: Context,
  operand: CheckExpression,
  guarded: ReadonlySet<string>,
): RuleNode | null {
  const readings = readExpression(context, operand, guarded);
  const [only, ...others] = readings ?? [];
  return only !== undefined &&
    others.length === 0 &&
    only.needs.length === 0 &&
    only.node.kind === "sentence"
    ? only.node
    : null;
}

/**
 * The alternatives of an OR without guards: the values of an `IN`, in the order they were
 * written (SQL Server stores them reversed), or else "at least one of these" when no
 * alternative can be unknown. Under three-valued logic an unknown alternative lets a row
 * through whatever the others say, so a sentence about them would be false.
 */
function readAlternatives(
  context: Context,
  operands: readonly CheckExpression[],
  guarded: ReadonlySet<string>,
): Reading[] | null {
  const list = equalityList(context, operands);
  if (list !== null) {
    return single(listReading(context, list.column, list.values.toReversed(), false, guarded));
  }
  const items: RuleNode[] = [];
  for (const operand of operands) {
    const item = alternative(context, operand, guarded);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return [{ node: anyOfGroup(items), needs: [] }];
}

/**
 * An OR, which may start with explicit guards: `c IS NULL OR rule` reads as the rule under
 * "When c has a value:", and a guard on a column that cannot be NULL is dropped.
 */
function readOr(
  context: Context,
  operands: readonly CheckExpression[],
  guarded: ReadonlySet<string>,
): Reading[] | null {
  const guards: Column[] = [];
  const rest: CheckExpression[] = [];
  for (const operand of operands) {
    const guard =
      operand.kind === "isNull" && !operand.negated ? classify(context, operand.operand) : null;
    if (guard?.kind === "column") {
      guards.push(guard.column);
    } else {
      rest.push(operand);
    }
  }
  const [first, ...others] = rest;
  if (guards.length === 0 || first === undefined) {
    return readAlternatives(context, operands, guarded);
  }
  const inner = new Set([...guarded, ...guards.map((column) => column.name)]);
  const readings =
    others.length === 0
      ? readExpression(context, first, inner)
      : readAlternatives(context, rest, inner);
  if (readings === null) {
    return null;
  }
  const extra = needsOf(guards, guarded);
  return readings.map((reading) => ({
    ...reading,
    needs: [...extra, ...reading.needs.filter((column) => !extra.includes(column))],
  }));
}

function readAnd(
  context: Context,
  operands: readonly CheckExpression[],
  guarded: ReadonlySet<string>,
): Reading[] | null {
  const readings: Reading[] = [];
  for (const operand of operands) {
    const read = readExpression(context, operand, guarded);
    if (read === null) {
      return null;
    }
    readings.push(...read);
  }
  return mergeReadings(context, readings);
}

/** The readings of `expression`, or `null` when any part of it is outside the forms the reader words. */
function readExpression(
  context: Context,
  expression: CheckExpression,
  guarded: ReadonlySet<string>,
): Reading[] | null {
  switch (expression.kind) {
    case "and":
      return readAnd(context, expression.operands, guarded);
    case "or":
      return readOr(context, expression.operands, guarded);
    case "not":
      return readNot(context, expression.operand, guarded);
    case "compare":
      return single(readCompare(context, expression, guarded));
    case "isNull":
      return single(readIsNull(context, expression.operand, expression.negated));
    case "like":
      return single(readLike(context, expression, expression.negated, guarded));
    case "between":
      return readBetween(context, expression, guarded);
    case "in":
      return single(readIn(context, expression, expression.negated, guarded));
    case "column":
    case "number":
    case "string":
    case "null":
    case "call":
    case "arithmetic":
    case "unary":
      return null;
  }
}

/** Whether two bounds make a range: numbers in order, or date texts of one format in order. */
function inOrder(low: Bound, high: Bound): boolean {
  if (typeof low.order === "number" && typeof high.order === "number") {
    return low.order <= high.order;
  }
  return (
    typeof low.order === "string" &&
    typeof high.order === "string" &&
    low.order.length === high.order.length &&
    low.order <= high.order
  );
}

function rangeReading(
  context: Context,
  low: Bound,
  needs: readonly Column[],
  high: Bound,
): Reading {
  const args = columnArguments(context, low.column);
  if (low.measure === "value") {
    return {
      node: sentence("rule.check.range", {
        ...args,
        low: literalArgument(low.text),
        high: literalArgument(high.text),
      }),
      needs,
    };
  }
  return {
    node: sentence(`rule.check.${low.measure}.between`, {
      ...args,
      low: { kind: "number", value: Number(low.text) },
      high: { kind: "number", value: Number(high.text) },
    }),
    needs,
  };
}

function sameNeeds(left: Reading, right: Reading): boolean {
  return (
    left.needs.length === right.needs.length &&
    left.needs.every((column) => right.needs.includes(column))
  );
}

/**
 * Joins the conditions of one AND list that read better together: a lower and an upper bound
 * on the same value, length or size become one range, and several values one column must
 * differ from become one list. Each takes the place of the first of its parts.
 */
function mergeReadings(context: Context, readings: readonly Reading[]): Reading[] {
  const slots: (Reading | null)[] = [...readings];
  slots.forEach((reading, index) => {
    const bound = reading?.bound;
    if (reading === null || bound === undefined) {
      return;
    }
    const partner = slots.findIndex(
      (other, otherIndex) =>
        otherIndex > index &&
        other?.bound?.measure === bound.measure &&
        other.bound.column === bound.column &&
        other.bound.operator !== bound.operator &&
        sameNeeds(reading, other),
    );
    const otherBound = slots[partner]?.bound;
    if (otherBound === undefined) {
      return;
    }
    const [low, high] = bound.operator === ">=" ? [bound, otherBound] : [otherBound, bound];
    if (inOrder(low, high)) {
      slots[index] = rangeReading(context, low, reading.needs, high);
      slots[partner] = null;
    }
  });
  slots.forEach((reading, index) => {
    const exclusion = reading?.exclusion;
    if (reading === null || exclusion === undefined) {
      return;
    }
    const texts = [exclusion.text];
    slots.forEach((other, otherIndex) => {
      if (
        otherIndex > index &&
        other?.exclusion?.column === exclusion.column &&
        sameNeeds(reading, other)
      ) {
        if (!texts.includes(other.exclusion.text)) {
          texts.push(other.exclusion.text);
        }
        slots[otherIndex] = null;
      }
    });
    if (texts.length > 1) {
      slots[index] = {
        node: sentence("rule.check.noneOf", {
          ...columnArguments(context, exclusion.column),
          values: { kind: "literals", texts, join: "and" },
        }),
        needs: reading.needs,
      };
    }
  });
  return slots.filter((reading): reading is Reading => reading !== null);
}

/**
 * The readings as rules: those that need no column first where they fall, and those that do
 * gathered under one "When … has a value:" heading per set of columns, at the place of the
 * first of them.
 */
function assemble(context: Context, readings: readonly Reading[]): RuleNode[] {
  const nodes: (RuleNode | { columns: readonly Column[]; items: RuleNode[] })[] = [];
  const groups = new Map<string, { columns: readonly Column[]; items: RuleNode[] }>();
  for (const reading of readings) {
    if (reading.needs.length === 0) {
      nodes.push(reading.node);
      continue;
    }
    const id = JSON.stringify(reading.needs.map((column) => column.name).sort());
    let group = groups.get(id);
    if (group === undefined) {
      group = { columns: reading.needs, items: [] };
      groups.set(id, group);
      nodes.push(group);
    }
    group.items.push(reading.node);
  }
  return nodes.map((node) =>
    "kind" in node
      ? node
      : whenPresentGroup(
          context.entity,
          node.columns.map((column) => column.name),
          node.items,
        ),
  );
}

/**
 * The reading of a stored `CHECK` text against the columns of its table: in full, or not at
 * all with the columns it mentions. `state` puts the rules of a constraint SQL Server does not
 * check, or whose state was not recorded, under "When enabled:", and those of one it marks as not
 * trusted after the sentence that says so, under a heading that names the columns it reads.
 */
function readStoredText(
  sql: string,
  columns: readonly Column[],
  entity: string,
  state: RuleState,
): CheckReading {
  const tokens = tokenizeCheck(sql);
  const untrusted = untrustedRules(state);
  if (tokens === null) {
    return { status: "unread", rules: untrusted, columns: [], sql };
  }
  const mentioned = referencedColumns(tokens, columns);
  const unread: CheckReading = { status: "unread", rules: untrusted, columns: mentioned, sql };
  const expression = parseCheck(tokens);
  if (expression === null || mentioned.length === 0) {
    return unread;
  }
  const context: Context = { columns, entity, notes: new Set() };
  let readings: Reading[] | null;
  try {
    readings = readExpression(context, expression, new Set());
  } catch {
    // A reader that fails shows the SQL; it never takes the panel down with it.
    return unread;
  }
  if (readings === null) {
    return unread;
  }
  return {
    status: "read",
    rules: stateRules(state, assemble(context, readings), mentioned),
    columns: mentioned,
    notes: context.notes,
    sql,
  };
}

/**
 * The words for `constraint`, a `CHECK` of the table `table` with `columns`. A text the capture
 * could not read is said to be not available or not recorded, with what is still known in words.
 */
export function readCheckConstraint(
  constraint: CheckConstraint,
  columns: readonly Column[],
  table: QualifiedName,
  provider: "sqlServer" | "postgreSql" = "sqlServer",
): CheckReading {
  if (provider === "postgreSql") {
    const text = definitionText(constraint.expression);
    return text === null
      ? {
          status: isUnknownDefinition(constraint.expression) ? "notRecorded" : "notAvailable",
          rules: [],
        }
      : { status: "unread", rules: [], columns: [], sql: text };
  }
  const state: RuleState = {
    rule: "check",
    table,
    isEnabled: constraint.isEnabled,
    isTrusted: constraint.isTrusted ?? null,
  };
  const text = definitionText(constraint.expression);
  if (text === null) {
    // Trust needs no VIEW DEFINITION, so a text the login cannot see still says it.
    return {
      status: isUnknownDefinition(constraint.expression) ? "notRecorded" : "notAvailable",
      rules: untrustedRules(state),
    };
  }
  return readStoredText(text, columns, entityKey(table), state);
}
