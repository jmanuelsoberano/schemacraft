import { isKeyword, isReservedWord } from "./checkTokens";
import type { CheckToken } from "./checkTokens";

/**
 * A small recursive-descent parser for `CHECK` expressions, with T-SQL precedence: OR, then
 * AND, then NOT (which binds looser than a comparison, as SQL Server stores `NOT [A]<(0)`),
 * then the predicates, then arithmetic. A parenthesised expression comes back as it is, so
 * `(0)`, `((0))` and `(-1)` need no special case, and an OR inside parentheses stays a node of
 * its own: the reader tells an `IN` list, stored as one OR chain, from a group written apart.
 * Anything outside the grammar (CASE, COLLATE, subqueries, casts) gives `null`, never a throw.
 */

export type ComparisonOperator = "=" | "<>" | "<" | "<=" | ">" | ">=";

export type ArithmeticOperator = "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^";

export type CheckExpression =
  | { kind: "and"; operands: readonly CheckExpression[] }
  | { kind: "or"; operands: readonly CheckExpression[] }
  | { kind: "not"; operand: CheckExpression }
  | {
      kind: "compare";
      operator: ComparisonOperator;
      left: CheckExpression;
      right: CheckExpression;
    }
  | { kind: "isNull"; operand: CheckExpression; negated: boolean }
  | {
      kind: "like";
      operand: CheckExpression;
      pattern: CheckExpression;
      escape: CheckExpression | null;
      negated: boolean;
    }
  | {
      kind: "between";
      operand: CheckExpression;
      low: CheckExpression;
      high: CheckExpression;
      negated: boolean;
    }
  | { kind: "in"; operand: CheckExpression; values: readonly CheckExpression[]; negated: boolean }
  /** A column by its unquoted name. */
  | { kind: "column"; name: string }
  /** A number as written, with its sign folded in, e.g. `-273.15`. */
  | { kind: "number"; text: string }
  | { kind: "string"; value: string; isUnicode: boolean }
  | { kind: "null" }
  /** A function call; `schema` only for a user-defined function such as `[dbo].[fn]`. */
  | {
      kind: "call";
      schema: string | null;
      name: string;
      /** Whether the name was bracketed, which a built-in function never is. */
      isQuoted: boolean;
      arguments: readonly CheckExpression[];
    }
  | {
      kind: "arithmetic";
      operator: ArithmeticOperator;
      left: CheckExpression;
      right: CheckExpression;
    }
  /** A sign or `~` before anything but a number. */
  | { kind: "unary"; operator: "-" | "+" | "~"; operand: CheckExpression };

/** Parentheses, NOTs and signs nested deeper than this are not read. */
export const MAX_CHECK_DEPTH = 64;

const COMPARISONS: Readonly<Partial<Record<string, ComparisonOperator>>> = {
  "=": "=",
  "<>": "<>",
  "!=": "<>",
  "<": "<",
  "<=": "<=",
  "!>": "<=",
  ">": ">",
  ">=": ">=",
  "!<": ">=",
};

const ADDITIVE = new Set<string>(["+", "-", "&", "|", "^"]);
const MULTIPLICATIVE = new Set<string>(["*", "/", "%"]);
const NEGATABLE_PREDICATES = ["like", "between", "in"];

function isArithmeticOperator(text: string): text is ArithmeticOperator {
  return ADDITIVE.has(text) || MULTIPLICATIVE.has(text);
}

function negateNumber(text: string): string {
  return text.startsWith("-") ? text.slice(1) : `-${text}`;
}

/** The expression the tokens spell, or `null` when they spell something outside the grammar. */
export function parseCheck(tokens: readonly CheckToken[]): CheckExpression | null {
  let position = 0;
  let depth = 0;

  const peek = (offset = 0): CheckToken | undefined => tokens[position + offset];

  const takePunctuation = (text: string): boolean => {
    const token = peek();
    if (token?.kind === "punctuation" && token.text === text) {
      position += 1;
      return true;
    }
    return false;
  };

  const takeKeyword = (keyword: string): boolean => {
    if (isKeyword(peek(), keyword)) {
      position += 1;
      return true;
    }
    return false;
  };

  /** Runs `read` one level deeper, refusing past {@link MAX_CHECK_DEPTH}. */
  const nested = (read: () => CheckExpression | null): CheckExpression | null => {
    depth += 1;
    const result = depth > MAX_CHECK_DEPTH ? null : read();
    depth -= 1;
    return result;
  };

  /** `operand (keyword operand)*` as one n-ary node, or the operand alone. */
  const parseChain = (
    kind: "or" | "and",
    readOperand: () => CheckExpression | null,
  ): CheckExpression | null => {
    const first = readOperand();
    if (first === null) {
      return null;
    }
    const operands = [first];
    while (takeKeyword(kind)) {
      const operand = readOperand();
      if (operand === null) {
        return null;
      }
      operands.push(operand);
    }
    return operands.length === 1 ? first : { kind, operands };
  };

  const parseOr = (): CheckExpression | null => parseChain("or", parseAnd);

  const parseAnd = (): CheckExpression | null => parseChain("and", parseNot);

  const parseNot = (): CheckExpression | null => {
    if (!takeKeyword("not")) {
      return parsePredicate();
    }
    const operand = nested(parseNot);
    return operand === null ? null : { kind: "not", operand };
  };

  const parsePredicate = (): CheckExpression | null => {
    const left = parseAdditive();
    if (left === null) {
      return null;
    }
    const token = peek();
    const operator = token?.kind === "operator" ? COMPARISONS[token.text] : undefined;
    if (operator !== undefined) {
      position += 1;
      const right = parseAdditive();
      return right === null ? null : { kind: "compare", operator, left, right };
    }
    if (takeKeyword("is")) {
      const negated = takeKeyword("not");
      return takeKeyword("null") ? { kind: "isNull", operand: left, negated } : null;
    }
    const negated =
      isKeyword(token, "not") &&
      NEGATABLE_PREDICATES.some((keyword) => isKeyword(peek(1), keyword));
    if (negated) {
      position += 1;
    }
    if (takeKeyword("like")) {
      const pattern = parseAdditive();
      if (pattern === null) {
        return null;
      }
      if (!takeKeyword("escape")) {
        return { kind: "like", operand: left, pattern, escape: null, negated };
      }
      const escape = parseAdditive();
      return escape === null ? null : { kind: "like", operand: left, pattern, escape, negated };
    }
    if (takeKeyword("between")) {
      const low = parseAdditive();
      if (low === null || !takeKeyword("and")) {
        return null;
      }
      const high = parseAdditive();
      return high === null ? null : { kind: "between", operand: left, low, high, negated };
    }
    if (takeKeyword("in")) {
      if (!takePunctuation("(")) {
        return null;
      }
      const values: CheckExpression[] = [];
      do {
        const value = parseAdditive();
        if (value === null) {
          return null;
        }
        values.push(value);
      } while (takePunctuation(","));
      return takePunctuation(")") ? { kind: "in", operand: left, values, negated } : null;
    }
    return left;
  };

  const parseArithmetic = (
    operators: ReadonlySet<string>,
    readOperand: () => CheckExpression | null,
  ): CheckExpression | null => {
    let left = readOperand();
    for (;;) {
      const token = peek();
      if (
        left === null ||
        token?.kind !== "operator" ||
        !operators.has(token.text) ||
        !isArithmeticOperator(token.text)
      ) {
        return left;
      }
      position += 1;
      const right = readOperand();
      left = right === null ? null : { kind: "arithmetic", operator: token.text, left, right };
    }
  };

  const parseAdditive = (): CheckExpression | null =>
    parseArithmetic(ADDITIVE, parseMultiplicative);

  const parseMultiplicative = (): CheckExpression | null =>
    parseArithmetic(MULTIPLICATIVE, parseUnary);

  const parseUnary = (): CheckExpression | null => {
    const token = peek();
    if (
      token?.kind !== "operator" ||
      (token.text !== "-" && token.text !== "+" && token.text !== "~")
    ) {
      return parsePrimary();
    }
    position += 1;
    const operand = nested(parseUnary);
    if (operand === null) {
      return null;
    }
    if (operand.kind === "number" && token.text !== "~") {
      return token.text === "+" ? operand : { kind: "number", text: negateNumber(operand.text) };
    }
    return { kind: "unary", operator: token.text, operand };
  };

  const parsePrimary = (): CheckExpression | null => {
    const token = peek();
    switch (token?.kind) {
      case "punctuation": {
        if (!takePunctuation("(")) {
          return null;
        }
        const inner = nested(parseOr);
        return inner !== null && takePunctuation(")") ? inner : null;
      }
      case "number":
        position += 1;
        return { kind: "number", text: token.text };
      case "string":
        position += 1;
        return { kind: "string", value: token.value, isUnicode: token.isUnicode };
      case "word":
        if (isKeyword(token, "null")) {
          position += 1;
          return { kind: "null" };
        }
        if (isKeyword(token, "current_timestamp")) {
          position += 1;
          return { kind: "call", schema: null, name: token.text, isQuoted: false, arguments: [] };
        }
        return isReservedWord(token) ? null : parseName();
      case "identifier":
        return parseName();
      case "binary":
      case "operator":
      case undefined:
        return null;
    }
  };

  /** A column, or a call to a function named with at most a schema. */
  const parseName = (): CheckExpression | null => {
    const parts: { text: string; isQuoted: boolean }[] = [];
    do {
      const token = peek();
      if (token?.kind === "identifier") {
        parts.push({ text: token.name, isQuoted: true });
      } else if (token?.kind === "word" && !isReservedWord(token)) {
        parts.push({ text: token.text, isQuoted: false });
      } else {
        return null;
      }
      position += 1;
    } while (takePunctuation("."));
    const [first, second, ...rest] = parts;
    const name = second ?? first;
    if (name === undefined || rest.length > 0) {
      return null;
    }
    if (!takePunctuation("(")) {
      return second === undefined ? { kind: "column", name: name.text } : null;
    }
    const callArguments: CheckExpression[] = [];
    if (!takePunctuation(")")) {
      do {
        const argument = nested(parseOr);
        if (argument === null) {
          return null;
        }
        callArguments.push(argument);
      } while (takePunctuation(","));
      if (!takePunctuation(")")) {
        return null;
      }
    }
    return {
      kind: "call",
      schema: second === undefined ? null : (first?.text ?? null),
      name: name.text,
      isQuoted: name.isQuoted,
      arguments: callArguments,
    };
  };

  const expression = parseOr();
  return expression !== null && position === tokens.length ? expression : null;
}
