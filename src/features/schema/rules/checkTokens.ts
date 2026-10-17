/**
 * Tokens of a `CHECK` expression as SQL Server stores it in `sys.check_constraints.definition`:
 * columns in brackets, numbers in parentheses, `like` in lower case. The tokenizer also takes
 * the forms a developer writes, so a normalisation that changes between versions still reads.
 * It gives up (returns `null`) on anything it does not know rather than guessing, and the
 * reader then shows the stored SQL.
 */

export type CheckToken =
  /** A bare word: a keyword, a function name or an unquoted column name, as written. */
  | { kind: "word"; text: string }
  /** A `[bracketed]` or `"quoted"` identifier, unescaped. */
  | { kind: "identifier"; name: string }
  /** A `'text'` or `N'text'` literal, unescaped. */
  | { kind: "string"; value: string; isUnicode: boolean }
  /** An unsigned number as written, e.g. `0`, `273.15` or `1.0000000000000000e+003`. */
  | { kind: "number"; text: string }
  /** A binary literal, e.g. `0x41`. */
  | { kind: "binary"; text: string }
  | { kind: "operator"; text: string }
  | { kind: "punctuation"; text: "(" | ")" | "," | "." };

/** `sys.check_constraints.definition` holds up to 4,000 characters in practice; longer is not read. */
export const MAX_CHECK_LENGTH = 4000;

/** A bound on the work the parser does for one expression. */
export const MAX_CHECK_TOKENS = 1000;

const TWO_CHARACTER_OPERATORS = new Set(["<>", "!=", ">=", "<=", "!<", "!>"]);
const ONE_CHARACTER_OPERATORS = new Set([
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "~",
]);
const PUNCTUATION = new Set(["(", ")", ",", "."]);

const WHITESPACE = /\s/u;
const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_@$#]/u;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u;
const BINARY = /^0[xX][0-9A-Fa-f]*/u;

/** Reads a quoted run that starts at `start` and ends at `close`, where a doubled `close` escapes it. */
function readQuoted(
  text: string,
  start: number,
  close: string,
): { value: string; end: number } | null {
  let value = "";
  let position = start;
  while (position < text.length) {
    const character = text.charAt(position);
    if (character === close) {
      if (text.charAt(position + 1) !== close) {
        return { value, end: position + 1 };
      }
      value += close;
      position += 2;
    } else {
      value += character;
      position += 1;
    }
  }
  return null;
}

function isPunctuation(character: string): character is "(" | ")" | "," | "." {
  return PUNCTUATION.has(character);
}

/**
 * The tokens of `text`, or `null` when it holds a comment, a character the grammar does not
 * use, an unterminated literal or identifier, or more than the limits allow.
 */
export function tokenizeCheck(text: string): CheckToken[] | null {
  if (text.length > MAX_CHECK_LENGTH) {
    return null;
  }
  const tokens: CheckToken[] = [];
  let position = 0;
  while (position < text.length) {
    if (tokens.length > MAX_CHECK_TOKENS) {
      return null;
    }
    const character = text.charAt(position);
    const next = text.charAt(position + 1);
    if (WHITESPACE.test(character)) {
      position += 1;
      continue;
    }
    if ((character === "-" && next === "-") || (character === "/" && next === "*")) {
      return null;
    }
    if (character === "[" || character === '"') {
      const quoted = readQuoted(text, position + 1, character === "[" ? "]" : '"');
      if (quoted === null) {
        return null;
      }
      tokens.push({ kind: "identifier", name: quoted.value });
      position = quoted.end;
      continue;
    }
    if (character === "'" || ((character === "N" || character === "n") && next === "'")) {
      const isUnicode = character !== "'";
      const quoted = readQuoted(text, position + (isUnicode ? 2 : 1), "'");
      if (quoted === null) {
        return null;
      }
      tokens.push({ kind: "string", value: quoted.value, isUnicode });
      position = quoted.end;
      continue;
    }
    const rest = text.slice(position);
    const binary = BINARY.exec(rest);
    if (binary !== null) {
      tokens.push({ kind: "binary", text: binary[0] });
      position += binary[0].length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number !== null) {
      tokens.push({ kind: "number", text: number[0] });
      position += number[0].length;
      continue;
    }
    if (WORD_START.test(character)) {
      let end = position + 1;
      while (end < text.length && WORD_PART.test(text.charAt(end))) {
        end += 1;
      }
      tokens.push({ kind: "word", text: text.slice(position, end) });
      position = end;
      continue;
    }
    const pair = character + next;
    if (TWO_CHARACTER_OPERATORS.has(pair)) {
      tokens.push({ kind: "operator", text: pair });
      position += 2;
      continue;
    }
    if (ONE_CHARACTER_OPERATORS.has(character)) {
      tokens.push({ kind: "operator", text: character });
      position += 1;
      continue;
    }
    if (isPunctuation(character)) {
      tokens.push({ kind: "punctuation", text: character });
      position += 1;
      continue;
    }
    return null;
  }
  return tokens.length > MAX_CHECK_TOKENS ? null : tokens;
}

/** Words of the grammar, matched in any case; a bare word among them never names a column. */
const KEYWORDS = new Set([
  "and",
  "as",
  "between",
  "case",
  "collate",
  "current_timestamp",
  "else",
  "end",
  "escape",
  "exists",
  "from",
  "in",
  "is",
  "like",
  "not",
  "null",
  "or",
  "select",
  "then",
  "when",
  "where",
]);

/** Whether `token` is the bare keyword `keyword`, given in lower case, in any case. */
export function isKeyword(token: CheckToken | undefined, keyword: string): boolean {
  return token?.kind === "word" && token.text.toLowerCase() === keyword;
}

/** Whether `token` is a bare word of the grammar, which never names a column or a function. */
export function isReservedWord(token: CheckToken | undefined): boolean {
  return token?.kind === "word" && KEYWORDS.has(token.text.toLowerCase());
}

/** Functions whose first argument is a type or a date part, never a column. */
const TYPE_OR_PART_FUNCTIONS = new Set([
  "convert",
  "try_convert",
  "dateadd",
  "datediff",
  "datediff_big",
  "datename",
  "datepart",
  "datetrunc",
  "date_bucket",
]);

/**
 * The column `name` stands for: the column of exactly that name, or else the only one whose
 * name matches in any case. `undefined` when there is none, or several in different cases.
 */
export function resolveColumn<Candidate extends { name: string }>(
  name: string,
  columns: readonly Candidate[],
): Candidate | undefined {
  const exact = columns.find((candidate) => candidate.name === name);
  if (exact !== undefined) {
    return exact;
  }
  const lower = name.toLowerCase();
  const matches = columns.filter((candidate) => candidate.name.toLowerCase() === lower);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Whether the identifier at `index` is a name that could be a column, judged by its neighbours. */
function isColumnPosition(tokens: readonly CheckToken[], index: number): boolean {
  if (isReservedWord(tokens[index])) {
    return false;
  }
  const before = tokens[index - 1];
  const after = tokens[index + 1];
  if (after?.kind === "punctuation" && (after.text === "(" || after.text === ".")) {
    return false;
  }
  if (before?.kind === "punctuation" && before.text === ".") {
    return false;
  }
  if (isKeyword(before, "collate")) {
    return false;
  }
  const call = tokens[index - 2];
  return !(
    before?.kind === "punctuation" &&
    before.text === "(" &&
    call?.kind === "word" &&
    TYPE_OR_PART_FUNCTIONS.has(call.text.toLowerCase())
  );
}

/**
 * The table columns an expression mentions, in order of first appearance, each once. It works
 * on tokens alone, so the columns of a rule the parser cannot read can still be highlighted.
 */
export function referencedColumns(
  tokens: readonly CheckToken[],
  columns: readonly { name: string }[],
): string[] {
  const found: string[] = [];
  tokens.forEach((token, index) => {
    if (
      (token.kind !== "identifier" && token.kind !== "word") ||
      !isColumnPosition(tokens, index)
    ) {
      return;
    }
    const resolved = resolveColumn(token.kind === "word" ? token.text : token.name, columns);
    if (resolved !== undefined && !found.includes(resolved.name)) {
      found.push(resolved.name);
    }
  });
  return found;
}
