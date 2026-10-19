import { describe, expect, it } from "vitest";

import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import {
  anyOfGroup,
  countedSentence,
  enabledRules,
  formatRuleText,
  ruleTextToString,
  sentence,
  stateRules,
  untrustedRules,
  whenPresentGroup,
} from "./ruleText";
import type { RuleNode, RuleState, RuleText, RuleTranslator } from "./ruleText";

const en: RuleTranslator = createCatalogTranslator(messageCatalogs.en, "en");
const es: RuleTranslator = createCatalogTranslator(messageCatalogs.es, "es");

function textOf(node: RuleNode | undefined): RuleText {
  if (node === undefined) {
    throw new Error("no node");
  }
  return node.kind === "sentence" ? node.text : node.heading;
}

function say(node: RuleNode | undefined, translator: RuleTranslator): string {
  return ruleTextToString(formatRuleText(textOf(node), translator));
}

const STATUS = { kind: "column", entity: "sales.Orders", name: "Status" } as const;

describe("formatRuleText", () => {
  it("lists values with the locale's own joins, each value a code part", () => {
    const oneOf = (texts: string[]) =>
      sentence("rule.check.oneOf", {
        column: STATUS,
        values: { kind: "literals", texts, join: "or" },
      });
    expect(formatRuleText(textOf(oneOf(["'A'", "'B'"])), en)).toEqual([
      { kind: "column", entity: "sales.Orders", name: "Status" },
      { kind: "text", text: " must be one of " },
      { kind: "code", text: "'A'" },
      { kind: "text", text: " or " },
      { kind: "code", text: "'B'" },
    ]);
    expect(say(oneOf(["'A'", "'I'", "'S'"]), en)).toBe("Status must be one of 'A', 'I', or 'S'");
    expect(say(oneOf(["'A'", "'I'", "'S'"]), es)).toBe(
      "Status debe ser uno de estos valores: 'A', 'I' o 'S'",
    );
    const noneOf = sentence("rule.check.noneOf", {
      column: STATUS,
      values: { kind: "literals", texts: ["'X'", "'Y'"], join: "and" },
    });
    expect(say(noneOf, en)).toBe("Status must be different from 'X' and 'Y'");
    expect(say(noneOf, es)).toBe("Status debe ser diferente de 'X' y 'Y'");
  });

  it("lists columns as column parts of their entity", () => {
    const heading = whenPresentGroup("sales.Orders", ["ShippedAt", "DueAt", "PaidAt"], []);
    expect(formatRuleText(textOf(heading), en)).toEqual([
      { kind: "text", text: "When " },
      { kind: "column", entity: "sales.Orders", name: "ShippedAt" },
      { kind: "text", text: ", " },
      { kind: "column", entity: "sales.Orders", name: "DueAt" },
      { kind: "text", text: ", and " },
      { kind: "column", entity: "sales.Orders", name: "PaidAt" },
      { kind: "text", text: " have values:" },
    ]);
    expect(say(heading, es)).toBe("Cuando ShippedAt, DueAt y PaidAt tienen valor:");
    expect(say(whenPresentGroup("sales.Orders", ["ShippedAt"], []), es)).toBe(
      "Cuando ShippedAt tiene un valor:",
    );
  });

  it("chooses the plural form by the locale's rules", () => {
    const length = (count: number) =>
      countedSentence("rule.check.length.exactly", count, { column: STATUS });
    expect(say(length(1), en)).toBe(
      "Status must have exactly 1 character, not counting trailing spaces",
    );
    expect(say(length(0), en)).toBe(
      "Status must have exactly 0 characters, not counting trailing spaces",
    );
    expect(say(length(1), es)).toBe(
      "Status debe tener exactamente 1 carácter, sin contar los espacios finales",
    );
    // Spanish puts a million in its "many" category, which reads as the plural.
    expect(new Intl.PluralRules("es").select(1_000_000)).toBe("many");
    expect(say(length(1_000_000), es)).toBe(
      "Status debe tener exactamente 1.000.000 caracteres, sin contar los espacios finales",
    );
  });

  it("formats counts and bounds as numbers of the locale, and literals as SQL writes them", () => {
    const size = countedSentence("rule.check.bytes.atMost", 1_048_576, {
      column: { kind: "column", entity: "dbo.Files", name: "Payload" },
    });
    expect(say(size, en)).toBe("Payload must take at most 1,048,576 bytes");
    expect(say(size, es)).toBe("Payload debe ocupar como máximo 1.048.576 bytes");
    const range = sentence("rule.check.length.between", {
      column: STATUS,
      low: { kind: "number", value: 2 },
      high: { kind: "number", value: 10_000 },
    });
    expect(say(range, es)).toBe(
      "Status debe tener entre 2 y 10.000 caracteres, ambos incluidos, sin contar los espacios finales",
    );
    const floor = sentence("rule.check.ge", {
      column: STATUS,
      value: { kind: "literal", text: "-273.15" },
    });
    expect(formatRuleText(textOf(floor), es).at(-1)).toEqual({ kind: "code", text: "-273.15" });
  });

  it("names tables in full wherever the sentence is shown", () => {
    const parts = formatRuleText(
      textOf(
        sentence("rule.fk.required", {
          child: { kind: "table", name: { schema: "sales", name: "Orders" } },
          parent: { kind: "table", name: { schema: "sales", name: "Customers" } },
        }),
      ),
      en,
    );
    expect(parts).toEqual([
      { kind: "text", text: "Each row in " },
      { kind: "table", key: "sales.Orders", label: "sales.Orders" },
      { kind: "text", text: " belongs to exactly one row in " },
      { kind: "table", key: "sales.Customers", label: "sales.Customers" },
    ]);
  });

  it("words the time now, the unknown side of a key and SQL keywords", () => {
    const now = (utc: boolean) =>
      sentence("rule.check.before", {
        column: STATUS,
        value: { kind: "now", utc },
      });
    expect(say(now(false), en)).toBe(
      "Status must be before the server's date and time when the value is saved",
    );
    expect(say(now(true), es)).toBe(
      "Status debe ser anterior a la fecha y hora UTC al guardar el valor",
    );
    const hidden = countedSentence("rule.fk.update.noAction", 1, {
      child: { kind: "table", name: { schema: "sales", name: "Orders" } },
      parent: { kind: "referencedTable" },
      parentColumns: { kind: "referencedKey" },
    });
    expect(say(hidden, en)).toBe(
      "Changing the referenced key of a row in the referenced table is blocked if, once the statement has run, rows in sales.Orders still point to its old value and no row in the referenced table has it",
    );
    const identity = sentence("rule.fk.update.identity", {
      parentColumns: { kind: "columns", entity: "dbo.Customers", names: ["Id"], join: "and" },
      action: { kind: "keyword", text: "SET NULL" },
    });
    expect(formatRuleText(textOf(identity), en)).toContainEqual({ kind: "code", text: "SET NULL" });
  });

  it("keeps a placeholder without an argument visible rather than dropping it", () => {
    expect(say(sentence("rule.check.gt", { column: STATUS }), en)).toBe(
      "Status must be greater than {value}",
    );
  });
});

describe("rule groups", () => {
  it("heads the alternatives of an OR", () => {
    expect(say(anyOfGroup([]), en)).toBe("At least one of these must hold:");
    expect(say(anyOfGroup([]), es)).toBe("Debe cumplirse al menos una de estas condiciones:");
  });

  it("puts the rules of a constraint SQL Server may not check under a heading", () => {
    const rules = [sentence("rule.check.required", { column: STATUS })];
    expect(enabledRules(true, rules)).toEqual(rules);
    const [disabled] = enabledRules(false, rules);
    expect(disabled).toMatchObject({
      group: { kind: "whenEnabled", isRecorded: true },
      items: rules,
    });
    expect(say(disabled, en)).toBe("When enabled:");
    const [notRecorded] = enabledRules(null, rules);
    expect(notRecorded).toMatchObject({ group: { kind: "whenEnabled", isRecorded: false } });
    expect(say(notRecorded, en)).toBe("If enabled (this file did not record whether it is):");
    expect(say(notRecorded, es)).toBe("Si la regla está habilitada (este archivo no lo registró):");
  });

  it("says the rows already there may not follow an enabled rule SQL Server marks as not trusted", () => {
    const rules = [sentence("rule.check.required", { column: STATUS })];
    const always = [sentence("rule.fk.parentMany", {})];
    const state = (overrides: Partial<RuleState>): RuleState => ({
      rule: "check",
      table: { schema: "sales", name: "Orders" },
      isEnabled: true,
      isTrusted: false,
      ...overrides,
    });

    const [notice, group] = stateRules(state({}), rules, ["Status"]);
    expect(say(notice, en)).toBe(
      "Rows already in sales.Orders may not follow this rule: SQL Server marks it as not trusted",
    );
    expect(say(notice, es)).toBe(
      "Las filas que ya hay en sales.Orders pueden no cumplir esta regla: SQL Server la marca como no confiable",
    );
    expect(notice?.kind === "sentence" && formatRuleText(notice.text, en)[1]).toEqual({
      kind: "table",
      key: "sales.Orders",
      label: "sales.Orders",
    });
    // SQL Server checks an UPDATE only when it writes one of the rule's columns, so the heading
    // names them, as chips of the rule's table.
    expect(group).toMatchObject({
      group: { kind: "whenWritten", rule: "check", columns: ["Status"] },
      items: rules,
    });
    expect(say(group, en)).toBe("When a row is inserted or its Status is changed:");
    expect(say(group, es)).toBe("Cuando se inserta una fila o se modifica su Status:");
    expect(group?.kind === "group" && formatRuleText(group.heading, en)[1]).toEqual({
      kind: "column",
      entity: "sales.Orders",
      name: "Status",
    });
    const [, pairGroup] = stateRules(state({ rule: "foreignKey" }), rules, ["A", "B"]);
    expect(pairGroup).toMatchObject({
      group: { kind: "whenWritten", rule: "foreignKey", columns: ["A", "B"] },
    });
    expect(say(pairGroup, en)).toBe("When a row is inserted or any of its A and B is changed:");
    expect(say(pairGroup, es)).toBe(
      "Cuando se inserta una fila o se modifica alguna de sus columnas A y B:",
    );
    // The sentences that hold for every row follow the group, outside it.
    const withAlways = stateRules(state({}), rules, ["Status"], always);
    expect(withAlways).toHaveLength(3);
    expect(withAlways[1]).toMatchObject({ kind: "group", items: rules });
    expect(withAlways[2]).toBe(always[0]);

    // Trusted, or trust not recorded: as before. Disabled, never trusted: under "When enabled:",
    // the sentences that hold for every row included.
    expect(stateRules(state({ isTrusted: true }), rules, ["Status"])).toEqual(rules);
    expect(stateRules(state({ isTrusted: null }), rules, ["Status"])).toEqual(rules);
    expect(stateRules(state({ isTrusted: true }), rules, ["Status"], always)).toEqual([
      ...rules,
      ...always,
    ]);
    expect(stateRules(state({ isEnabled: false }), rules, ["Status"])).toEqual(
      enabledRules(false, rules),
    );
    expect(stateRules(state({ isEnabled: false }), rules, ["Status"], always)).toEqual(
      enabledRules(false, [...rules, ...always]),
    );
    expect(stateRules(state({ isEnabled: null, isTrusted: null }), rules, ["Status"])).toEqual(
      enabledRules(null, rules),
    );
    expect(untrustedRules(state({ isEnabled: false }))).toEqual([]);
    expect(untrustedRules(state({}))).toHaveLength(1);
  });
});

describe("ruleTextToString", () => {
  it("joins the parts as plain text", () => {
    expect(
      ruleTextToString([
        { kind: "column", entity: "sales.Orders", name: "Status" },
        { kind: "text", text: " = " },
        { kind: "code", text: "'A'" },
        { kind: "text", text: " in " },
        { kind: "table", key: "sales.Orders", label: "sales.Orders" },
      ]),
    ).toBe("Status = 'A' in sales.Orders");
  });
});
