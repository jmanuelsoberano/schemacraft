import { describe, expect, it } from "vitest";

import golden from "../../../../crates/schemacraft-core/tests/fixtures/sqlserver/check_forms.json";
import { parseCheck } from "./checkParser";
import type { CheckExpression } from "./checkParser";
import {
  MAX_CHECK_LENGTH,
  MAX_CHECK_TOKENS,
  referencedColumns,
  tokenizeCheck,
} from "./checkTokens";

function tokens(text: string) {
  const result = tokenizeCheck(text);
  if (result === null) {
    throw new Error(`${text} does not tokenize`);
  }
  return result;
}

function parse(text: string): CheckExpression | null {
  const result = tokenizeCheck(text);
  return result === null ? null : parseCheck(result);
}

const column = (name: string) => ({ kind: "column", name }) as const;
const number = (text: string) => ({ kind: "number", text }) as const;
const named = (...names: string[]) => names.map((name) => ({ name }));

describe("tokenizeCheck", () => {
  it("reads bracketed identifiers with doubled closing brackets", () => {
    expect(tokens("([Weird]]Name]>(0))")).toEqual([
      { kind: "punctuation", text: "(" },
      { kind: "identifier", name: "Weird]Name" },
      { kind: "operator", text: ">" },
      { kind: "punctuation", text: "(" },
      { kind: "number", text: "0" },
      { kind: "punctuation", text: ")" },
      { kind: "punctuation", text: ")" },
    ]);
    expect(tokens('"Order Date"')).toEqual([{ kind: "identifier", name: "Order Date" }]);
    expect(tokens('"say ""hi"""')).toEqual([{ kind: "identifier", name: 'say "hi"' }]);
  });

  it("reads text literals, with doubled quotes and the N prefix", () => {
    expect(tokens("'it''s' N'Ñandú' n'x' ''")).toEqual([
      { kind: "string", value: "it's", isUnicode: false },
      { kind: "string", value: "Ñandú", isUnicode: true },
      { kind: "string", value: "x", isUnicode: true },
      { kind: "string", value: "", isUnicode: false },
    ]);
  });

  it("reads numbers with fractions and exponents, and binary literals apart", () => {
    expect(tokens("1.0000000000000000e+003 273.15 .5 7E2 0x41")).toEqual([
      { kind: "number", text: "1.0000000000000000e+003" },
      { kind: "number", text: "273.15" },
      { kind: "number", text: ".5" },
      { kind: "number", text: "7E2" },
      { kind: "binary", text: "0x41" },
    ]);
    // A minus sign is an operator; the parser folds it into the number.
    expect(tokens("-273.15").map((token) => token.kind)).toEqual(["operator", "number"]);
  });

  it("reads one- and two-character operators and keeps words as written", () => {
    expect(
      tokens("a<>b!=c>=d<=e!<f!>g=h<i>j+k-l*m/n%o").filter((t) => t.kind === "operator"),
    ).toEqual(
      ["<>", "!=", ">=", "<=", "!<", "!>", "=", "<", ">", "+", "-", "*", "/", "%"].map((text) => ({
        kind: "operator",
        text,
      })),
    );
    expect(tokens("Trim(x) like")).toEqual([
      { kind: "word", text: "Trim" },
      { kind: "punctuation", text: "(" },
      { kind: "word", text: "x" },
      { kind: "punctuation", text: ")" },
      { kind: "word", text: "like" },
    ]);
  });

  it.each([
    ["a line comment", "[A] > 0 -- positive"],
    ["a block comment", "[A] /* positive */ > 0"],
    ["an unterminated text", "[A] = 'open"],
    ["an unterminated identifier", "[A > 0"],
    ["an unknown character", "[A] > $5"],
    ["a lone exclamation mark", "[A] ! 0"],
  ])("gives up on %s", (_label, text) => {
    expect(tokenizeCheck(text)).toBeNull();
  });

  it("gives up on texts and token lists over the limits", () => {
    expect(tokenizeCheck(`[A]='${"x".repeat(MAX_CHECK_LENGTH)}'`)).toBeNull();
    const longest = Array.from({ length: MAX_CHECK_TOKENS }, () => "1").join(" ");
    expect(tokenizeCheck(longest)).toHaveLength(MAX_CHECK_TOKENS);
    expect(tokenizeCheck(`${longest} 1`)).toBeNull();
  });
});

describe("referencedColumns", () => {
  it("collects table columns in order of first appearance, each once", () => {
    const columns = named("Kind", "Amount", "Code");
    expect(
      referencedColumns(
        tokens("(case when [Kind]=(1) then [Amount] else (0) end>=(0) AND [Kind]<(9))"),
        columns,
      ),
    ).toEqual(["Kind", "Amount"]);
  });

  it("leaves out function names, schema names and identifiers that are not columns", () => {
    const columns = named("Code", "dbo", "fn_IsValidCode", "getdate");
    expect(
      referencedColumns(
        tokens("([dbo].[fn_IsValidCode]([Code])=(1) AND [Nope]<getdate())"),
        columns,
      ),
    ).toEqual(["Code"]);
  });

  it("leaves out type and date part arguments and collation names", () => {
    const columns = named("date", "day", "Latin1_General_CS_AS", "HiredOn", "T");
    expect(
      referencedColumns(
        tokens(
          "(CONVERT([date],[HiredOn])<dateadd(day,(-1),getdate()) AND ([T]) collate Latin1_General_CS_AS='AB')",
        ),
        columns,
      ),
    ).toEqual(["HiredOn", "T"]);
  });

  it("matches the exact name first, then a unique name in any case", () => {
    expect(referencedColumns(tokens("[quantity]>(0)"), named("Quantity"))).toEqual(["Quantity"]);
    expect(referencedColumns(tokens("[code]>(0)"), named("Code", "CODE"))).toEqual([]);
    expect(referencedColumns(tokens("[CODE]>(0)"), named("Code", "CODE"))).toEqual(["CODE"]);
  });
});

describe("parseCheck", () => {
  it("unwraps redundant parentheses around values and predicates", () => {
    expect(parse("(((([Quantity]))>((0))))")).toEqual({
      kind: "compare",
      operator: ">",
      left: column("Quantity"),
      right: number("0"),
    });
  });

  it("keeps AND above OR and leaves a parenthesised group nested", () => {
    expect(parse("([Kind]=(1) OR [Kind]=(2) AND [Amount]>(0))")).toEqual({
      kind: "or",
      operands: [
        { kind: "compare", operator: "=", left: column("Kind"), right: number("1") },
        {
          kind: "and",
          operands: [
            { kind: "compare", operator: "=", left: column("Kind"), right: number("2") },
            { kind: "compare", operator: ">", left: column("Amount"), right: number("0") },
          ],
        },
      ],
    });
    expect(parse("(([A]=(1) OR [A]=(2)) OR [B]=(3))")).toMatchObject({
      kind: "or",
      operands: [{ kind: "or" }, { kind: "compare" }],
    });
  });

  it("binds NOT looser than a comparison and a LIKE", () => {
    expect(parse("(NOT [Quantity]<(0))")).toEqual({
      kind: "not",
      operand: { kind: "compare", operator: "<", left: column("Quantity"), right: number("0") },
    });
    expect(parse("(NOT [Phone] like '%[^0-9]%')")).toEqual({
      kind: "not",
      operand: {
        kind: "like",
        operand: column("Phone"),
        pattern: { kind: "string", value: "%[^0-9]%", isUnicode: false },
        escape: null,
        negated: false,
      },
    });
  });

  it("reads the unexpanded predicates in any keyword case", () => {
    expect(
      parse("[Rating] bEtWeEn 1 AnD 5 and [Status] NOT IN ('A', N'B') aNd [T] iS nOt NuLl"),
    ).toEqual({
      kind: "and",
      operands: [
        {
          kind: "between",
          operand: column("Rating"),
          low: number("1"),
          high: number("5"),
          negated: false,
        },
        {
          kind: "in",
          operand: column("Status"),
          values: [
            { kind: "string", value: "A", isUnicode: false },
            { kind: "string", value: "B", isUnicode: true },
          ],
          negated: true,
        },
        { kind: "isNull", operand: column("T"), negated: true },
      ],
    });
    expect(parse("([Code] like '%!%%' escape '!' )")).toMatchObject({
      kind: "like",
      escape: { kind: "string", value: "!" },
    });
  });

  it("normalises the negated comparison operators", () => {
    expect(parse("[A]!=(1)")).toMatchObject({ kind: "compare", operator: "<>" });
    expect(parse("[A]!<(1)")).toMatchObject({ kind: "compare", operator: ">=" });
    expect(parse("[A]!>(1)")).toMatchObject({ kind: "compare", operator: "<=" });
    expect(parse("((0)<[Quantity])")).toEqual({
      kind: "compare",
      operator: "<",
      left: number("0"),
      right: column("Quantity"),
    });
  });

  it("folds a sign into a number and keeps it apart from anything else", () => {
    expect(parse("([Temperature]>=(-273.15))")).toMatchObject({ right: number("-273.15") });
    expect(parse("[A]>-(-2)")).toMatchObject({ right: number("2") });
    expect(parse("[A]>+1")).toMatchObject({ right: number("1") });
    expect(parse("(( -[Quantity])<(0))")).toMatchObject({
      left: { kind: "unary", operator: "-", operand: column("Quantity") },
    });
    expect(parse("([Price]*[Quantity]<=(10000))")).toMatchObject({
      left: { kind: "arithmetic", operator: "*", left: column("Price"), right: column("Quantity") },
    });
  });

  it("reads calls, qualified or not, and the niladic CURRENT_TIMESTAMP", () => {
    expect(parse("([dbo].[fn_IsValidCode]([Code])=(1))")).toMatchObject({
      left: {
        kind: "call",
        schema: "dbo",
        name: "fn_IsValidCode",
        isQuoted: true,
        arguments: [column("Code")],
      },
    });
    expect(parse("(ltrim(rtrim([Name]))<>'')")).toMatchObject({
      left: {
        kind: "call",
        schema: null,
        name: "ltrim",
        isQuoted: false,
        arguments: [{ kind: "call", name: "rtrim", arguments: [column("Name")] }],
      },
    });
    expect(parse("[CreatedAt]<=CURRENT_TIMESTAMP")).toMatchObject({
      right: { kind: "call", schema: null, name: "CURRENT_TIMESTAMP", arguments: [] },
    });
    expect(parse("([ShippedAt]<=getdate())")).toMatchObject({
      right: { kind: "call", name: "getdate", arguments: [] },
    });
    expect(parse("([Status]=NULL)")).toMatchObject({ right: { kind: "null" } });
  });

  it.each([
    ["CASE", "(case when [Kind]=(1) then [Amount] else (0) end>=(0))"],
    ["COLLATE", "(([T]) collate Latin1_General_CS_AS='AB')"],
    ["EXISTS", "(EXISTS (SELECT 1))"],
    ["a subquery", "([A] IN (SELECT [B] FROM [T]))"],
    ["a binary literal", "([T]<>0x41)"],
    ["CAST", "(CAST([A] AS int)>(0))"],
    ["a qualified column", "([T].[A]>(0))"],
    ["a three-part call", "([db].[dbo].[fn]([A])=(1))"],
    ["tokens left over", "([A]>(0)) [B]"],
    ["a missing parenthesis", "([A]>(0)"],
    ["a dangling operator", "([A]>)"],
    ["chained comparisons", "([A]<[B]<[C])"],
    ["nothing", ""],
  ])("gives up on %s", (_label, text) => {
    expect(parse(text)).toBeNull();
  });

  it("gives up past the nesting limit", () => {
    expect(parse(`${"(".repeat(64)}[A]>0${")".repeat(64)}`)).not.toBeNull();
    expect(parse(`${"(".repeat(65)}[A]>0${")".repeat(65)}`)).toBeNull();
    expect(parse(`${"NOT ".repeat(64)}[A]>0`)).not.toBeNull();
    expect(parse(`${"NOT ".repeat(65)}[A]>0`)).toBeNull();
    expect(parse(`[A]>${"- ".repeat(64)}1`)).not.toBeNull();
    expect(parse(`[A]>${"- ".repeat(65)}1`)).toBeNull();
  });

  it("parses every golden stored form the grammar covers", () => {
    for (const goldenCase of golden.cases) {
      const parsed = parse(goldenCase.stored);
      if (goldenCase.name === "CK_RuleForms_CaseExpression") {
        expect(parsed, goldenCase.name).toBeNull();
      } else {
        expect(parsed, goldenCase.name).not.toBeNull();
      }
    }
  });

  it("returns null for every truncation of every golden form, and never throws", () => {
    // Each stored form is wrapped in one pair of parentheses, so every proper prefix is
    // unbalanced and must be refused rather than read as a shorter expression.
    for (const goldenCase of golden.cases) {
      for (let end = 0; end < goldenCase.stored.length; end += 1) {
        const prefix = goldenCase.stored.slice(0, end);
        expect(() => parse(prefix), prefix).not.toThrow();
        expect(parse(prefix), prefix).toBeNull();
      }
    }
  });
});
