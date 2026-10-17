import { formatMessage, pluralKey } from "./formatMessage";
import type { MessageParameters } from "./formatMessage";
import type { Locale } from "./locales";

/**
 * Keys of a catalogue that come in `one`/`other` plural forms, referred to by their common
 * prefix: `statusBar.tables` for `statusBar.tables.one` and `statusBar.tables.other`.
 */
export type PluralBase<Key extends string> = {
  [Candidate in Key]: Candidate extends `${infer Base}.one`
    ? `${Base}.other` extends Key
      ? Base
      : never
    : never;
}[Key];

/**
 * Translates the keys of one catalogue. The application builds it over the whole catalogue of
 * the chosen language; the standalone viewer over the subset embedded in its file, so both say
 * the same words through the same interpolation and plural rules. A translator over a wider
 * catalogue is assignable to one over a subset of it, which is how a module that needs a few
 * keys accepts either. `Base`, the plural bases of `Key`, is a parameter of its own only to
 * keep `Key` contravariant for that narrowing; it is never given by hand.
 */
export interface CatalogTranslator<Key extends string, Base extends string = PluralBase<Key>> {
  locale: Locale;
  /** Translates a message, interpolating `{placeholders}`. */
  t: (key: Key, parameters?: MessageParameters) => string;
  /** Translates a counted message, choosing the plural form for `count`. */
  tCount: (base: Base, count: number) => string;
  /** The message as written, with its `{placeholders}` in place, for a renderer that styles them. */
  template: (key: Key) => string;
}

/** A translator over `catalog`, with no store or framework behind it. */
export function createCatalogTranslator<Key extends string>(
  catalog: Readonly<Record<Key, string>>,
  locale: Locale,
): CatalogTranslator<Key> {
  const template = (key: Key): string => catalog[key];
  return {
    locale,
    t: (key, parameters) => formatMessage(template(key), parameters),
    // The plural form of a base is a key of the catalogue by the definition of `PluralBase`.
    tCount: (base, count) =>
      formatMessage(template(pluralKey(base, count, locale) as Key), { count }),
    template,
  };
}
