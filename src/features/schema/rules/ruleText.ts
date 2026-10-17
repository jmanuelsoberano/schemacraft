import type { QualifiedName } from "@/shared/contracts";
import { formatMessageParts, pluralKey } from "@/shared/i18n/formatMessage";
import type { Locale } from "@/shared/i18n/locales";
import type { RuleMessageKey, RulePluralBase } from "@/shared/i18n/messages/rules/en";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import { entityKey } from "../entities";

/**
 * Sentences as data. A reader says what a rule means as a message key with typed arguments
 * (columns, tables, values), never as finished text, so the Inspector and the viewer word it
 * in either language from the same reading, and a renderer can draw a column as a chip that
 * highlights it on the diagram. Nothing here knows the DOM, React or a store.
 */

/** The words the rules are said in. The application's translator narrows to it, and so does the viewer's. */
export type RuleTranslator = CatalogTranslator<RuleMessageKey>;

/** How a list of columns or values reads: "A, B and C" or "A, B or C". */
export type ListJoin = "and" | "or";

export type RuleArgument =
  /** A column of the entity `entity` (an entity key such as `sales.Orders`). */
  | { kind: "column"; entity: string; name: string }
  | { kind: "columns"; entity: string; names: readonly string[]; join: ListJoin }
  | { kind: "table"; name: QualifiedName }
  /** The table a key to a table the login cannot see points to, whose name is unknown. */
  | { kind: "referencedTable" }
  /** The key columns of that table, also unknown. */
  | { kind: "referencedKey" }
  /** A SQL literal as SQL writes it, e.g. `'A'`, `0` or `-273.15`. */
  | { kind: "literal"; text: string }
  | { kind: "literals"; texts: readonly string[]; join: ListJoin }
  /** The date and time when the value is saved: the server's local time, or UTC. */
  | { kind: "now"; utc: boolean }
  /** A SQL keyword kept as written, e.g. `CASCADE`. */
  | { kind: "keyword"; text: string }
  /** A count, formatted for the locale, e.g. 1,048,576. */
  | { kind: "number"; value: number };

export type RuleArguments = Readonly<Record<string, RuleArgument>>;

/** One sentence or heading: a message, or a counted message whose form follows `count`. */
export type RuleText =
  | { key: RuleMessageKey; args: RuleArguments }
  | { plural: RulePluralBase; count: number; args: RuleArguments };

/** What a group of rules means, for a renderer that styles it and for tests. */
export type RuleGroup =
  /** The rules apply only when every one of the columns has a value. */
  | { kind: "whenPresent"; columns: readonly string[] }
  /** At least one of the rules must hold. */
  | { kind: "anyOf" }
  /**
   * The rules of a constraint SQL Server does not check now (`isRecorded`), or whose state
   * the file did not record.
   */
  | { kind: "whenEnabled"; isRecorded: boolean };

export type RuleNode =
  | { kind: "sentence"; text: RuleText }
  | { kind: "group"; group: RuleGroup; heading: RuleText; items: readonly RuleNode[] };

/** A run of a formatted sentence. Columns and tables are named so a renderer can highlight them. */
export type RulePart =
  | { kind: "text"; text: string }
  | { kind: "column"; entity: string; name: string }
  | { kind: "table"; key: string; label: string }
  | { kind: "code"; text: string };

export function sentence(key: RuleMessageKey, args: RuleArguments = {}): RuleNode {
  return { kind: "sentence", text: { key, args } };
}

export function countedSentence(
  plural: RulePluralBase,
  count: number,
  args: RuleArguments = {},
): RuleNode {
  return { kind: "sentence", text: { plural, count, args } };
}

/** The group of rules that apply only when every column in `columns` has a value. */
export function whenPresentGroup(
  entity: string,
  columns: readonly string[],
  items: readonly RuleNode[],
): RuleNode {
  return {
    kind: "group",
    group: { kind: "whenPresent", columns },
    heading: {
      plural: "rule.check.whenPresent",
      count: columns.length,
      args: { columns: { kind: "columns", entity, names: columns, join: "and" } },
    },
    items,
  };
}

/** The group of rules of which at least one must hold. */
export function anyOfGroup(items: readonly RuleNode[]): RuleNode {
  return {
    kind: "group",
    group: { kind: "anyOf" },
    heading: { key: "rule.check.anyOf", args: {} },
    items,
  };
}

/**
 * The rules of a constraint as they read: as they are when it is enabled, or under "When
 * enabled:" when it is disabled or its state was not recorded, so a constraint SQL Server may
 * not check is never described as if it did.
 */
export function enabledRules(isEnabled: boolean | null, rules: readonly RuleNode[]): RuleNode[] {
  if (isEnabled === true) {
    return [...rules];
  }
  const isRecorded = isEnabled === false;
  return [
    {
      kind: "group",
      group: { kind: "whenEnabled", isRecorded },
      heading: { key: isRecorded ? "rule.whenEnabled" : "rule.whenEnabled.notRecorded", args: {} },
      items: rules,
    },
  ];
}

const LIST_TYPES = { and: "conjunction", or: "disjunction" } as const;

const listFormats = new Map<string, Intl.ListFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function listFormat(locale: Locale, join: ListJoin): Intl.ListFormat {
  const id = `${locale}:${join}`;
  let format = listFormats.get(id);
  if (format === undefined) {
    format = new Intl.ListFormat(locale, { type: LIST_TYPES[join] });
    listFormats.set(id, format);
  }
  return format;
}

function numberFormat(locale: Locale): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

/** The items of a list as parts, joined the locale's way: "'A', 'I', or 'S'" or "'A', 'I' o 'S'". */
function listParts(
  items: readonly string[],
  join: ListJoin,
  locale: Locale,
  part: (item: string) => RulePart,
): RulePart[] {
  let element = 0;
  return listFormat(locale, join)
    .formatToParts(items)
    .map((piece): RulePart => {
      if (piece.type === "literal") {
        return { kind: "text", text: piece.value };
      }
      const item = items[element] ?? piece.value;
      element += 1;
      return part(item);
    });
}

function argumentParts(argument: RuleArgument, translator: RuleTranslator): RulePart[] {
  const { locale } = translator;
  switch (argument.kind) {
    case "column":
      return [{ kind: "column", entity: argument.entity, name: argument.name }];
    case "columns":
      return listParts(argument.names, argument.join, locale, (name) => ({
        kind: "column",
        entity: argument.entity,
        name,
      }));
    case "table": {
      // Always qualified, so a sentence reads the same in the Inspector, the exported viewer
      // and the canvas, whichever table it is shown next to.
      const key = entityKey(argument.name);
      return [{ kind: "table", key, label: key }];
    }
    case "referencedTable":
      return [{ kind: "text", text: translator.template("rule.value.referencedTable") }];
    case "referencedKey":
      return [{ kind: "text", text: translator.template("rule.value.referencedKey") }];
    case "literal":
      return [{ kind: "code", text: argument.text }];
    case "literals":
      return listParts(argument.texts, argument.join, locale, (text) => ({ kind: "code", text }));
    case "now":
      return [
        {
          kind: "text",
          text: translator.template(argument.utc ? "rule.value.utcNow" : "rule.value.now"),
        },
      ];
    case "keyword":
      return [{ kind: "code", text: argument.text }];
    case "number":
      return [{ kind: "text", text: numberFormat(locale).format(argument.value) }];
  }
}

/**
 * A sentence as parts in the translator's language: its template split around the
 * placeholders, each argument drawn as text, a column, a table or code. No part of the
 * sentence is put together by concatenation, so word order stays the translation's.
 */
export function formatRuleText(text: RuleText, translator: RuleTranslator): RulePart[] {
  const template = translator.template(
    "key" in text ? text.key : pluralKey(text.plural, text.count, translator.locale),
  );
  const args: RuleArguments =
    "key" in text ? text.args : { count: { kind: "number", value: text.count }, ...text.args };
  const parts: RulePart[] = [];
  for (const piece of formatMessageParts(template, args)) {
    const pieces: RulePart[] =
      piece.kind === "text"
        ? [{ kind: "text", text: piece.text }]
        : argumentParts(piece.value, translator);
    for (const part of pieces) {
      const last = parts.at(-1);
      if (part.kind === "text" && last?.kind === "text") {
        last.text += part.text;
      } else if (part.kind !== "text" || part.text !== "") {
        parts.push(part);
      }
    }
  }
  return parts;
}

/** The plain text of formatted parts, for an accessible name or a one-line label. */
export function ruleTextToString(parts: readonly RulePart[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case "text":
        case "code":
          return part.text;
        case "column":
          return part.name;
        case "table":
          return part.label;
      }
    })
    .join("");
}
