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
