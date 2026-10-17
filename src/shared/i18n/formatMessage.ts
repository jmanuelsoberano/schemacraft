export type MessageParameters = Readonly<Record<string, string | number>>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Replaces `{name}` placeholders with the given parameters. Unknown placeholders are left
 * untouched so that a missing parameter is visible instead of silently dropped.
 */
export function formatMessage(template: string, parameters: MessageParameters = {}): string {
  return template.replace(PLACEHOLDER_PATTERN, (placeholder: string, name: string) => {
    const value = parameters[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** A run of a message template: plain text, or a placeholder together with its parameter. */
export type MessagePart<Value> =
  { kind: "text"; text: string } | { kind: "parameter"; name: string; value: Value };

/**
 * Splits a message template into its text and its `{placeholders}`, paired with the given
 * parameters, so a renderer can draw each parameter its own way (a chip, a code span) without
 * putting the sentence together by concatenation. Like {@link formatMessage}, it keeps an
 * unknown placeholder visible as text. Adjacent text is merged and empty text is dropped.
 */
export function formatMessageParts<Value>(
  template: string,
  parameters: Readonly<Partial<Record<string, Value>>>,
): MessagePart<Value>[] {
  const parts: MessagePart<Value>[] = [];
  const pushText = (text: string) => {
    if (text === "") {
      return;
    }
    const last = parts.at(-1);
    if (last?.kind === "text") {
      last.text += text;
    } else {
      parts.push({ kind: "text", text });
    }
  };
  let position = 0;
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const [placeholder, name = ""] = match;
    pushText(template.slice(position, match.index));
    position = match.index + placeholder.length;
    const value = Object.hasOwn(parameters, name) ? parameters[name] : undefined;
    if (value === undefined) {
      pushText(placeholder);
    } else {
      parts.push({ kind: "parameter", name, value });
    }
  }
  pushText(template.slice(position));
  return parts;
}

/** Names of the `{placeholders}` used by a message template, in order of first appearance. */
export function placeholderNames(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? "");
}

/** Resolves the plural form of a message for `count` under the locale's plural rules. */
export function pluralKey<Base extends string>(
  base: Base,
  count: number,
  locale: string,
): `${Base}.one` | `${Base}.other` {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one" ? `${base}.one` : `${base}.other`;
}
