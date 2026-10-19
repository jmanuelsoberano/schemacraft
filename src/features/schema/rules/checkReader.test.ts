import { describe, expect, it } from "vitest";

import type { CheckConstraint, Column, SqlDataType } from "@/shared/contracts";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import golden from "../../../../crates/schemacraft-core/tests/fixtures/sqlserver/check_forms.json";
import { entityKey } from "../entities";
import { readCheckConstraint } from "./checkReader";
import type { CheckReading } from "./checkReader";
import { formatRuleText, ruleTextToString } from "./ruleText";
import type { RuleArgument, RuleNode, RuleText, RuleTranslator } from "./ruleText";

/**
 * The CHECK reader against the golden forms SQL Server stores (check_forms.json, whose stored
 * texts the SQL Server integration test pins against the engine), then against synthetic forms.
 * Readings are compared through a language-neutral signature, the notation of the golden file;
 * the words themselves are checked separately in both languages.
 */

type Signature =
  | string
  | { when: string[]; rules: Signature[] }
  | { anyOf: Signature[] }
  | {
      whenEnabled: Signature[];
    }
  | { whenEnabledNotRecorded: Signature[] }
  | { whenWritten: Signature[] };

interface GoldenCase {
  name: string;
  stored: string;
  enabled?: boolean;
  columns: string[];
  reading: "unread" | { rules: Signature[]; notes: string[] };
}

// The JSON holds the reading notation as plain strings and objects; this is its shape.
const GOLDEN_CASES = golden.cases as unknown as readonly GoldenCase[];
const TABLE = golden.table;
const ENTITY = entityKey(TABLE);

/** A column of the given SQL declaration, e.g. `decimal(18,2)`, `varchar(max)` or `datetime2(0)`. */
function dataType(declaration: string): SqlDataType {
  const [, name = declaration, first, second] =
    /^(\w+)(?:\((\w+)(?:,(\d+))?\))?$/u.exec(declaration) ?? [];
  const type: SqlDataType = {
    name,
    length: null,
    precision: null,
    scale: null,
    userDefinedTypeName: null,
  };
  if (first === undefined) {
    return type;
  }
  if (/char|binary/u.test(name)) {
    return {
      ...type,
      length:
        first === "max" ? { kind: "max" } : { kind: "fixed", value: Number.parseInt(first, 10) },
    };
  }
  return {
    ...type,
    precision: Number.parseInt(first, 10),
    scale: second === undefined ? null : Number.parseInt(second, 10),
  };
}

function column(name: string, declaration: string, isNullable: boolean): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: dataType(declaration),
    isNullable,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

const COLUMNS: readonly Column[] = [
  ...golden.columns.map((entry) => column(entry.name, entry.type, entry.nullable)),
  column("ShippedOn", "date", true),
  column("ArrivedAt", "datetimeoffset(0)", true),
  column("OpensAt", "time(0)", false),
  column("Notes", "text", true),
];

function check(
  text: string,
  isEnabled: boolean | null = true,
  isTrusted?: boolean,
): CheckConstraint {
  return {
    name: "CK_Test",
    expression: { status: "readable", text },
    isEnabled,
    ...(isTrusted === undefined ? {} : { isTrusted }),
  };
}

function read(text: string, isEnabled: boolean | null = true, isTrusted?: boolean): CheckReading {
  return readCheckConstraint(check(text, isEnabled, isTrusted), COLUMNS, TABLE);
}

function argumentSignature(argument: RuleArgument): string {
  switch (argument.kind) {
    case "column":
      return argument.name;
    case "columns":
      return argument.names.join(", ");
    case "literal":
    case "keyword":
      return argument.text;
    case "literals":
      return argument.texts.join(", ");
    case "names":
      return argument.names.join(", ");
    case "now":
      return argument.utc ? "utcNow" : "now";
    case "number":
      return String(argument.value);
    case "table":
      return entityKey(argument.name);
    case "referencedTable":
    case "referencedKey":
      return argument.kind;
  }
}

const OPERATORS: Readonly<Record<string, string>> = {
  "rule.check.eq": "=",
  "rule.check.ne": "<>",
  "rule.check.gt": ">",
  "rule.check.ge": ">=",
  "rule.check.lt": "<",
  "rule.check.le": "<=",
  "rule.check.after": ">",
  "rule.check.onOrAfter": ">=",
  "rule.check.before": "<",
  "rule.check.onOrBefore": "<=",
};

const BOUNDS: Readonly<Record<string, string>> = { exactly: "=", atLeast: ">=", atMost: "<=" };

const MEASURED = /^rule\.check\.(length|bytes)\.(exactly|atLeast|atMost)$/u;

/** The other sentences as calls, given their arguments' signatures. */
const CALLS: Readonly<Record<string, (argument: (name: string) => string) => string>> = {
  "rule.check.range": (a) => `between(${a("column")}, ${a("low")}, ${a("high")})`,
  "rule.check.length.between": (a) => `between(length(${a("column")}), ${a("low")}, ${a("high")})`,
  "rule.check.bytes.between": (a) => `between(bytes(${a("column")}), ${a("low")}, ${a("high")})`,
  "rule.check.oneOf": (a) => `oneOf(${a("column")}, ${a("values")})`,
  "rule.check.noneOf": (a) => `noneOf(${a("column")}, ${a("values")})`,
  "rule.check.startsWith": (a) => `startsWith(${a("column")}, ${a("value")})`,
  "rule.check.endsWith": (a) => `endsWith(${a("column")}, ${a("value")})`,
  "rule.check.endsWithExactly": (a) => `endsWithExactly(${a("column")}, ${a("value")})`,
  "rule.check.contains": (a) => `contains(${a("column")}, ${a("value")})`,
  "rule.check.notContains": (a) => `notContains(${a("column")}, ${a("value")})`,
  "rule.check.matches": (a) => `matches(${a("column")}, ${a("pattern")})`,
  "rule.check.notMatches": (a) => `notMatches(${a("column")}, ${a("pattern")})`,
  "rule.check.required": (a) => `required(${a("column")})`,
  "rule.check.null": (a) => `null(${a("column")})`,
  "rule.check.notBlank": (a) => `notBlank(${a("column")})`,
  "rule.check.notEmpty": (a) => `notEmpty(${a("column")})`,
  "rule.check.onlyDigits": (a) => `onlyDigits(${a("column")})`,
  "rule.trust.notVerified": (a) => `notVerified(${a("table")})`,
};

/** One sentence in the notation of the golden file, e.g. `Quantity > 0` or `oneOf(A, 'x')`. */
function sentenceSignature(text: RuleText): string {
  const argument = (name: string): string => {
    const value = text.args[name];
    if (value === undefined) {
      throw new Error(`missing argument ${name}`);
    }
    return argumentSignature(value);
  };
  if ("plural" in text) {
    const [, measure, bound = ""] = MEASURED.exec(text.plural) ?? [];
    if (measure === undefined) {
      throw new Error(`no signature for ${text.plural}`);
    }
    return `${measure}(${argument("column")}) ${BOUNDS[bound] ?? "?"} ${text.count}`;
  }
  const operator = OPERATORS[text.key];
  if (operator !== undefined) {
    return `${argument("column")} ${operator} ${argument("value")}`;
  }
  const call = CALLS[text.key];
  if (call === undefined) {
    throw new Error(`no signature for ${text.key}`);
  }
  return call(argument);
}

function signature(nodes: readonly RuleNode[]): Signature[] {
  return nodes.map((node): Signature => {
    if (node.kind === "sentence") {
      return sentenceSignature(node.text);
    }
    const rules = signature(node.items);
    switch (node.group.kind) {
      case "whenPresent":
        return { when: [...node.group.columns], rules };
      case "anyOf":
        return { anyOf: rules };
      case "whenEnabled":
        return node.group.isRecorded ? { whenEnabled: rules } : { whenEnabledNotRecorded: rules };
      case "whenWritten":
        return { whenWritten: rules };
    }
  });
}

/** The reading of `text` in the golden notation, or "unread". */
function readingOf(text: string, isEnabled: boolean | null = true, isTrusted?: boolean) {
  const reading = read(text, isEnabled, isTrusted);
  switch (reading.status) {
    case "read":
      return { rules: signature(reading.rules), notes: [...reading.notes].sort() };
    case "unread":
      return "unread";
    case "notAvailable":
    case "notRecorded":
      return reading.status;
  }
}

function rulesOf(text: string, isEnabled: boolean | null = true): readonly RuleNode[] {
  const reading = read(text, isEnabled);
  if (reading.status !== "read") {
    throw new Error(`${text} is not read`);
  }
  return reading.rules;
}

const translators: Readonly<Record<"en" | "es", RuleTranslator>> = {
  en: createCatalogTranslator(messageCatalogs.en, "en"),
  es: createCatalogTranslator(messageCatalogs.es, "es"),
};

/** Every sentence and heading of a reading as plain text, depth first. */
function wording(nodes: readonly RuleNode[], translator: RuleTranslator): string[] {
  return nodes.flatMap((node) => {
    const own = ruleTextToString(
      formatRuleText(node.kind === "sentence" ? node.text : node.heading, translator),
    );
    return node.kind === "sentence" ? [own] : [own, ...wording(node.items, translator)];
  });
}

describe("readCheckConstraint on the golden forms", () => {
  it.each(GOLDEN_CASES)("reads $name", (goldenCase) => {
    const reading = read(goldenCase.stored, goldenCase.enabled ?? true);
    expect(reading).toMatchObject({ sql: goldenCase.stored, columns: goldenCase.columns });
    if (goldenCase.reading === "unread") {
      expect(reading.status).toBe("unread");
      return;
    }
    expect(readingOf(goldenCase.stored, goldenCase.enabled ?? true)).toEqual({
      rules: goldenCase.reading.rules,
      notes: [...goldenCase.reading.notes].sort(),
    });
  });

  it("never leaves a placeholder unfilled in either language", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const reading = read(goldenCase.stored, goldenCase.enabled ?? true);
      if (reading.status !== "read") {
        continue;
      }
      for (const translator of Object.values(translators)) {
        for (const line of wording(reading.rules, translator)) {
          expect(line, goldenCase.name).not.toMatch(/[{}]/u);
        }
      }
    }
  });

  it("refuses every truncation of every golden form without throwing", () => {
    for (const goldenCase of GOLDEN_CASES) {
      for (let end = 0; end < goldenCase.stored.length; end += 1) {
        const prefix = goldenCase.stored.slice(0, end);
        expect(read(prefix).status, prefix).toBe("unread");
      }
    }
  });
});

describe("readCheckConstraint on what the capture says about the text", () => {
  it("says a text the login cannot see is not available, and a 1.0 gap not recorded", () => {
    const states = (["notVisible", "unknown", "notRecorded"] as const).map(
      (status) =>
        readCheckConstraint({ name: "CK", expression: { status }, isEnabled: true }, COLUMNS, TABLE)
          .status,
    );
    expect(states).toEqual(["notAvailable", "notAvailable", "notRecorded"]);
  });

  it("still says the rows already there may not follow a rule whose text is missing", () => {
    // Trust needs no VIEW DEFINITION, so a login that cannot see the text still sees it.
    const hidden = (isEnabled: boolean | null, isTrusted?: boolean) =>
      readCheckConstraint(
        {
          name: "CK",
          expression: { status: "notVisible" },
          isEnabled,
          ...(isTrusted === undefined ? {} : { isTrusted }),
        },
        COLUMNS,
        TABLE,
      );
    const untrusted = hidden(true, false);
    expect(untrusted.status).toBe("notAvailable");
    expect(untrusted.status === "notAvailable" && signature(untrusted.rules)).toEqual([
      `notVerified(${ENTITY})`,
    ]);
    expect(hidden(true, true)).toEqual({ status: "notAvailable", rules: [] });
    expect(hidden(true)).toEqual({ status: "notAvailable", rules: [] });
    expect(hidden(false, false)).toEqual({ status: "notAvailable", rules: [] });
    expect(
      readCheckConstraint(
        { name: "CK", expression: { status: "notRecorded" }, isEnabled: true, isTrusted: false },
        COLUMNS,
        TABLE,
      ),
    ).toMatchObject({ status: "notRecorded", rules: [{ kind: "sentence" }] });
  });

  it("gives up on texts it cannot tokenize, keeping what columns it can", () => {
    expect(read(`([Code]='${"x".repeat(4000)}')`)).toEqual({
      status: "unread",
      rules: [],
      columns: [],
      sql: `([Code]='${"x".repeat(4000)}')`,
    });
    expect(read("([Code]='open)")).toMatchObject({ status: "unread", columns: [] });
  });

  it("gives up when a name is not a column of the table, and highlights the ones that are", () => {
    expect(read("([Quantity]>[Missing])")).toMatchObject({
      status: "unread",
      columns: ["Quantity"],
    });
  });

  it("reads columns written in another case", () => {
    expect(readingOf("([quantity]>(0))")).toEqual({ rules: ["Quantity > 0"], notes: [] });
  });
});

describe("readCheckConstraint and NULL", () => {
  it("puts a rule over two nullable columns under one heading for both", () => {
    expect(readingOf("([DueAt]>=[ShippedAt])")).toEqual({
      rules: [{ when: ["DueAt", "ShippedAt"], rules: ["DueAt >= ShippedAt"] }],
      notes: [],
    });
  });

  it("groups the rules of an AND list by the columns they need", () => {
    expect(readingOf("([Rating]>(0) AND [Quantity]>(0) AND [Rating]<(9))")).toEqual({
      rules: [{ when: ["Rating"], rules: ["Rating > 0", "Rating < 9"] }, "Quantity > 0"],
      notes: [],
    });
  });

  it("reads several explicit guards as one heading", () => {
    expect(readingOf("([Rating] IS NULL OR [Discount] IS NULL OR [Rating]>[Discount])")).toEqual({
      rules: [{ when: ["Rating", "Discount"], rules: ["Rating > Discount"] }],
      notes: [],
    });
    // A guard on another column: the rule applies when both have a value.
    expect(readingOf("([ShippedAt] IS NULL OR [DueAt]>=[ShippedAt])")).toEqual({
      rules: [{ when: ["ShippedAt", "DueAt"], rules: ["DueAt >= ShippedAt"] }],
      notes: [],
    });
    expect(readingOf("([Quantity] IS NULL OR [Total]>(0))")).toEqual({
      rules: ["Total > 0"],
      notes: [],
    });
  });

  it("reads a list of values on a nullable column under its heading", () => {
    expect(readingOf("([TaxId]='B' OR [TaxId]='A')")).toEqual({
      rules: [{ when: ["TaxId"], rules: ["oneOf(TaxId, 'A', 'B')"] }],
      notes: ["collation"],
    });
  });

  it("reads OR only when no branch can be unknown", () => {
    expect(readingOf("([Kind]=(1) OR [Amount]>(0))")).toEqual({
      rules: [{ anyOf: ["Kind = 1", "Amount > 0"] }],
      notes: [],
    });
    expect(readingOf("([Rating] IS NULL OR [Kind]=(1) OR [Amount]>(0))")).toEqual({
      rules: [{ when: ["Rating"], rules: [{ anyOf: ["Kind = 1", "Amount > 0"] }] }],
      notes: [],
    });
    expect(read("([Kind]=(1) OR [Rating]>(0))").status).toBe("unread");
    expect(read("([Rating] IS NULL OR [Rating]>(5) OR [Bonus]>(0))").status).toBe("unread");
  });

  it("refuses every comparison with a NULL literal", () => {
    for (const text of [
      "([Quantity]<>NULL)",
      "([Status] IN ('A', NULL))",
      "([Status] NOT IN ('A', NULL))",
      "(NOT [Status]=NULL)",
      "([Rating] BETWEEN NULL AND (5))",
      "([Code] like NULL)",
    ]) {
      expect(read(text).status, text).toBe("unread");
    }
  });
});

describe("readCheckConstraint on enabled state", () => {
  it("reads a disabled constraint under 'When enabled:'", () => {
    expect(readingOf("([Rating]>(0))", false)).toEqual({
      rules: [{ whenEnabled: [{ when: ["Rating"], rules: ["Rating > 0"] }] }],
      notes: [],
    });
  });

  it("does not claim a constraint is checked when the file did not record it", () => {
    expect(readingOf("([Quantity]>(0))", null)).toEqual({
      rules: [{ whenEnabledNotRecorded: ["Quantity > 0"] }],
      notes: [],
    });
  });
});

describe("readCheckConstraint on trust", () => {
  const forms = `${TABLE.schema}.${TABLE.name}`;

  it("says the rows already there may not follow a rule SQL Server marks as not trusted", () => {
    expect(readingOf("([Rating]>(0))", true, false)).toEqual({
      rules: [
        `notVerified(${forms})`,
        { whenWritten: [{ when: ["Rating"], rules: ["Rating > 0"] }] },
      ],
      notes: [],
    });
  });

  it("names the columns the rule reads in the heading, since only writing one is checked", () => {
    const reading = read("([Quantity]>(0) AND [Rating]<=(5))", true, false);
    const group = reading.status === "read" ? reading.rules[1] : undefined;
    expect(group?.kind === "group" && group.group).toEqual({
      kind: "whenWritten",
      rule: "check",
      columns: ["Quantity", "Rating"],
    });
  });

  it("adds nothing for a trusted rule or one whose trust was not recorded", () => {
    const plain = { rules: ["Quantity > 0"], notes: [] };
    expect(readingOf("([Quantity]>(0))", true, true)).toEqual(plain);
    expect(readingOf("([Quantity]>(0))", true)).toEqual(plain);
  });

  it("reads a disabled rule, never trusted, under 'When enabled:' alone", () => {
    expect(readingOf("([Quantity]>(0))", false, false)).toEqual({
      rules: [{ whenEnabled: ["Quantity > 0"] }],
      notes: [],
    });
  });

  it("still says it of a rule it cannot put into words", () => {
    const reading = read("([dbo].[fn_check]([Code])=(1))", true, false);
    expect(reading.status).toBe("unread");
    expect(reading.status === "unread" && signature(reading.rules)).toEqual([
      `notVerified(${forms})`,
    ]);
    const trusted = read("([dbo].[fn_check]([Code])=(1))", true, true);
    expect(trusted.status === "unread" && trusted.rules).toEqual([]);
  });

  it("words the sentence and the heading in both languages", () => {
    const reading = read("([Quantity]>(0))", true, false);
    const lines = (translator: RuleTranslator) =>
      reading.status === "read"
        ? reading.rules.map((node) =>
            ruleTextToString(
              formatRuleText(node.kind === "sentence" ? node.text : node.heading, translator),
            ),
          )
        : [];
    expect(lines(createCatalogTranslator(messageCatalogs.en, "en"))).toEqual([
      `Rows already in ${forms} may not follow this rule: SQL Server marks it as not trusted`,
      "When a row is inserted or its Quantity is changed:",
    ]);
    expect(lines(createCatalogTranslator(messageCatalogs.es, "es"))).toEqual([
      `Las filas que ya hay en ${forms} pueden no cumplir esta regla: SQL Server la marca como no confiable`,
      "Cuando se inserta una fila o se modifica su Quantity:",
    ]);
  });
});

describe("readCheckConstraint on forms written out", () => {
  it.each([
    ["[Rating] BETWEEN 1 AND 5", [{ when: ["Rating"], rules: ["between(Rating, 1, 5)"] }], []],
    ["[Status] IN ('A', 'B')", ["oneOf(Status, 'A', 'B')"], ["collation"]],
    ["[Status] NOT IN ('A', 'B')", ["noneOf(Status, 'A', 'B')"], ["collation"]],
    ["(NOT [Status]='A')", ["Status <> 'A'"], ["collation"]],
    [
      "([Status]<>'A' AND [Status]<>'B' AND [Status]<>'A')",
      ["noneOf(Status, 'A', 'B')"],
      ["collation"],
    ],
    ["(NOT [TaxId] IS NULL)", ["required(TaxId)"], []],
    ["([TaxId] IS NULL)", ["null(TaxId)"], []],
    [
      "([Phone] NOT LIKE '%x%')",
      [{ when: ["Phone"], rules: ["notContains(Phone, 'x')"] }],
      ["collation"],
    ],
    ["(NOT [Code] like 'A_%')", ["notMatches(Code, 'A_%')"], ["collation", "pattern"]],
    ["([Code] like 'AB')", ["matches(Code, 'AB')"], ["collation", "pattern"]],
    ["([Code] like 'A %')", ["matches(Code, 'A %')"], ["collation", "pattern"]],
    // Unicode matching counts trailing spaces: an nvarchar column, or a varchar one against N'…'.
    ["([Name] like N'%-X')", ["endsWithExactly(Name, '-X')"], ["collation"]],
    ["([Code] like N'%-X')", ["endsWithExactly(Code, '-X')"], ["collation"]],
    ["([Status] like '%X')", ["endsWith(Status, 'X')"], ["collation"]],
    ["(NOT [Name] like N'%[^0-9]%')", ["onlyDigits(Name)"], ["collation"]],
    ["([Quantity]>=(0) AND [Quantity]<=(10))", ["between(Quantity, 0, 10)"], []],
    ["([Quantity]<=(10) AND [Quantity]>=(0))", ["between(Quantity, 0, 10)"], []],
    ["([Quantity]>=(10) AND [Quantity]<=(0))", ["Quantity >= 10", "Quantity <= 0"], []],
    [
      "([HiredOn]>='2000-01-01' AND [HiredOn]<='2009-12-31')",
      ["between(HiredOn, '2000-01-01', '2009-12-31')"],
      [],
    ],
  ])("reads %s", (text, rules, notes) => {
    expect(readingOf(text)).toEqual({ rules, notes });
  });
});

describe("readCheckConstraint on lengths and sizes", () => {
  it.each([
    ["(len([Code])>(3))", ["length(Code) >= 4"]],
    ["(len([Code])<(10))", ["length(Code) <= 9"]],
    ["(len([Code])>=(1))", ["notBlank(Code)"]],
    ["(len([Code])<>(0))", ["notBlank(Code)"]],
    ["(len([Code])=(1))", ["length(Code) = 1"]],
    ["(len([Code])>(1) AND len([Code])<(11))", ["between(length(Code), 2, 10)"]],
    ["(datalength([Code])>(0))", ["notEmpty(Code)"]],
    ["(datalength([Code])>=(2) AND datalength([Code])<=(8))", ["between(bytes(Code), 2, 8)"]],
    ["(datalength([Payload])>(0))", [{ when: ["Payload"], rules: ["notEmpty(Payload)"] }]],
    ["(rtrim([Code])<>'')", ["notBlank(Code)"]],
  ])("reads %s", (text, rules) => {
    expect(readingOf(text)).toMatchObject({ rules });
  });

  it.each([
    "(len([Code])>(1.5))",
    "(len([Quantity])>(0))",
    "(len([Code])>=(0))",
    "(len([Code])<(1))",
    "(len([Code])<>(3))",
    "(datalength([Quantity])>(0))",
    "(trim([Code])='')",
    "(trim([Code])>'')",
    "([Code]='')",
  ])("leaves %s unread", (text) => {
    expect(read(text).status).toBe("unread");
  });
});

describe("readCheckConstraint on types", () => {
  it.each([
    ["text ordered as text", "([Code]>'M')"],
    ["a number against text", "([Code]=(5))"],
    ["text against a number", "([Quantity]='5')"],
    ["a date column against the time now", "([ShippedOn]<=getdate())"],
    ["a column with an offset against local time", "([ArrivedAt]<=getdate())"],
    ["an offset literal", "([ArrivedAt]>='2000-01-01')"],
    ["dates of different types", "([StartDate]<=[CreatedAt])"],
    ["text against a date", "([HiredOn]>'01/02/2000')"],
    ["a binary literal", "([Payload]<>0x41)"],
    ["a collation", "(([Code]) collate Latin1_General_CS_AS='AB')"],
    ["a type that cannot be compared", "([Notes]='x')"],
    ["a column alone", "([Quantity])"],
    ["a sign before a column", "(( -[Quantity])<(0))"],
    ["a function of the time now", "([DueAt]<dateadd(day,(30),getdate()))"],
    ["digits only on a text padded with spaces", "(NOT [Status] like '%[^0-9]%')"],
    // char and nchar pad a shorter value with spaces, which LIKE sees.
    ["a suffix on nchar, where the padding counts", "([Ref] like '%-X')"],
    ["a Unicode suffix on char, where the padding counts", "([Currency] like N'%X')"],
    ["an exact pattern on nchar", "([Ref] like N'[A-Z][A-Z]')"],
    ["a pattern on char whose _ can match the padding", "([Currency] like 'A_')"],
    ["a pattern ending in % whose _ can match the padding", "([Currency] like '[A-Z]_%')"],
    ["NOT LIKE a pattern on char", "(NOT [Currency] like 'A_')"],
    ["NOT LIKE a pattern on nchar", "(NOT [Ref] like N'A_')"],
  ])("leaves %s unread", (_label, text) => {
    expect(read(text).status).toBe("unread");
  });

  it.each([
    ["([Ref] like N'AB%')", ["startsWith(Ref, 'AB')"]],
    ["([Currency] like 'A%')", ["startsWith(Currency, 'A')"]],
    ["([Ref] like '%A B%')", ["contains(Ref, 'A B')"]],
    ["(NOT [Ref] like N'%AB%')", ["notContains(Ref, 'AB')"]],
    ["([Currency] like '%-X')", ["endsWith(Currency, '-X')"]],
  ])("reads %s on a text padded with spaces, which the padding cannot change", (text, rules) => {
    expect(readingOf(text)).toEqual({ rules, notes: ["collation"] });
  });

  it.each([
    ["([LoggedAt]>='20000201')", [{ when: ["LoggedAt"], rules: ["LoggedAt >= '20000201'"] }]],
    [
      "([LoggedAt]<'2000-02-01T08:30:00')",
      [{ when: ["LoggedAt"], rules: ["LoggedAt < '2000-02-01T08:30:00'"] }],
    ],
    ["([ArrivedAt]<=sysdatetimeoffset())", [{ when: ["ArrivedAt"], rules: ["ArrivedAt <= now"] }]],
    ["([OpensAt]>='08:00')", ["OpensAt >= '08:00'"]],
    ["([CreatedAt]<=getutcdate())", ["CreatedAt <= utcNow"]],
  ])("reads %s", (text, rules) => {
    expect(readingOf(text)).toEqual({ rules, notes: [] });
  });
});

describe("the words of a reading", () => {
  function words(text: string, locale: "en" | "es", isEnabled: boolean | null = true) {
    return wording(rulesOf(text, isEnabled), translators[locale]);
  }

  it("lists values the way each language does", () => {
    const stored = "([Status]='C' OR [Status]='S' OR [Status]='P' OR [Status]='N')";
    expect(words(stored, "en")).toEqual(["Status must be one of 'N', 'P', 'S', or 'C'"]);
    expect(words(stored, "es")).toEqual([
      "Status debe ser uno de estos valores: 'N', 'P', 'S' o 'C'",
    ]);
    expect(words("(NOT ([Currency]='XTS' OR [Currency]='XXX'))", "es")).toEqual([
      "Currency debe ser diferente de 'XXX' y 'XTS'",
    ]);
  });

  it("says a range is inclusive, under the heading of its nullable column", () => {
    const stored = "([Rating]>=(1) AND [Rating]<=(5))";
    expect(words(stored, "en")).toEqual([
      "When Rating has a value:",
      "Rating must be between 1 and 5, both included",
    ]);
    expect(words(stored, "es")).toEqual([
      "Cuando Rating tiene un valor:",
      "Rating debe estar entre 1 y 5, ambos incluidos",
    ]);
    expect(words("([DueAt]>=[ShippedAt])", "en")[0]).toBe("When DueAt and ShippedAt have values:");
    expect(words("([DueAt]>=[ShippedAt])", "es")[0]).toBe("Cuando DueAt y ShippedAt tienen valor:");
  });

  it("counts characters in the singular and the plural, without trailing spaces", () => {
    expect(words("(len([Code])=(1))", "en")).toEqual([
      "Code must have exactly 1 character, not counting trailing spaces",
    ]);
    expect(words("(len([Code])=(5))", "en")).toEqual([
      "Code must have exactly 5 characters, not counting trailing spaces",
    ]);
    expect(words("(len([Code])=(1))", "es")).toEqual([
      "Code debe tener exactamente 1 carácter, sin contar los espacios finales",
    ]);
    expect(words("(len([Code])=(5))", "es")).toEqual([
      "Code debe tener exactamente 5 caracteres, sin contar los espacios finales",
    ]);
  });

  it("formats counts for the locale", () => {
    const stored = "(datalength([Payload])<=(1048576))";
    expect(words(stored, "en")[1]).toBe("Payload must take at most 1,048,576 bytes");
    expect(words(stored, "es")[1]).toBe("Payload debe ocupar como máximo 1.048.576 bytes");
  });

  it("says what blank means", () => {
    expect(words("([Code]<>'')", "en")).toEqual(["Code must not be empty or contain only spaces"]);
    expect(words("([Code]<>'')", "es")).toEqual([
      "Code no puede quedar en blanco ni contener solo espacios",
    ]);
  });

  it("says whether trailing spaces count in a pattern", () => {
    expect(words("([Code] like '%-X')", "en")).toEqual([
      "Code must end with '-X', not counting trailing spaces",
    ]);
    expect(words("([Name] like N'%-X')", "en")).toEqual([
      "Name must end with '-X', with no spaces after it",
    ]);
    expect(words("([Name] like N'%-X')", "es")).toEqual([
      "Name debe terminar en '-X', sin espacios después",
    ]);
    expect(words("(NOT [Code] like '%[^0-9]%')", "en")).toEqual([
      "Code must contain only digits from 0 to 9; an empty value is accepted too",
    ]);
    expect(words("(NOT [Code] like '%[^0-9]%')", "es")).toEqual([
      "Code solo puede contener dígitos del 0 al 9; también se admite un valor vacío",
    ]);
  });

  it("words the time now as the moment the value is saved", () => {
    expect(words("([ShippedAt]<=getdate())", "en")[1]).toBe(
      "ShippedAt must be on or before the server's date and time when the value is saved",
    );
    expect(words("([ShippedAt]<=getdate())", "es")[1]).toBe(
      "ShippedAt debe ser igual o anterior a la fecha y hora del servidor al guardar el valor",
    );
    expect(words("(sysutcdatetime()>=[CreatedAt])", "en")).toEqual([
      "CreatedAt must be on or before the UTC date and time when the value is saved",
    ]);
  });

  it("heads alternatives and disabled rules", () => {
    const stored = "([Phone] IS NOT NULL OR [Email] IS NOT NULL)";
    expect(words(stored, "en")).toEqual([
      "At least one of these must hold:",
      "Phone must have a value",
      "Email must have a value",
    ]);
    expect(words(stored, "es")).toEqual([
      "Debe cumplirse al menos una de estas condiciones:",
      "Phone debe tener un valor",
      "Email debe tener un valor",
    ]);
    expect(words("([Quantity]<=(1000))", "en", false)).toEqual([
      "When enabled:",
      "Quantity must be less than or equal to 1000",
    ]);
    expect(words("([Quantity]<=(1000))", "es", false)).toEqual([
      "Cuando se habilite:",
      "Quantity debe ser menor o igual que 1000",
    ]);
  });

  it("keeps literals as SQL writes them and columns as chips", () => {
    const [rule] = rulesOf("([Code] like 'it''s%')");
    expect(rule?.kind === "sentence" && formatRuleText(rule.text, translators.en)).toEqual([
      { kind: "column", entity: ENTITY, name: "Code" },
      { kind: "text", text: " must start with " },
      { kind: "code", text: "'it''s'" },
    ]);
  });
});
