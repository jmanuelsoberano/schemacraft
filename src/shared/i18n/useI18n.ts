import { useMemo } from "react";

import { useSettingsStore } from "@/shared/settings/settingsStore";

import { formatMessage, pluralKey } from "./formatMessage";
import type { MessageParameters } from "./formatMessage";
import type { Locale } from "./locales";
import { messageCatalogs } from "./messages/catalogs";
import type { MessageKey, PluralMessageBase } from "./messages/en";

export interface Translator {
  locale: Locale;
  /** Translates a message, interpolating `{placeholders}`. */
  t: (key: MessageKey, parameters?: MessageParameters) => string;
  /** Translates a counted message, choosing the plural form for `count`. */
  tCount: (base: PluralMessageBase, count: number) => string;
}

export function translate(locale: Locale, key: MessageKey, parameters?: MessageParameters): string {
  return formatMessage(messageCatalogs[locale][key], parameters);
}

export function useI18n(): Translator {
  const locale = useSettingsStore((state) => state.locale);

  return useMemo(
    () => ({
      locale,
      t: (key, parameters) => translate(locale, key, parameters),
      tCount: (base, count) => translate(locale, pluralKey(base, count, locale), { count }),
    }),
    [locale],
  );
}
