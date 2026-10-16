import { useMemo } from "react";

import { useSettingsStore } from "@/shared/settings/settingsStore";

import { formatMessage } from "./formatMessage";
import type { MessageParameters } from "./formatMessage";
import type { Locale } from "./locales";
import { messageCatalogs } from "./messages/catalogs";
import type { MessageKey } from "./messages/en";
import { createCatalogTranslator } from "./translator";
import type { CatalogTranslator } from "./translator";

/** The application's translator: the whole catalogue of the chosen language. */
export type Translator = CatalogTranslator<MessageKey>;

export function translate(locale: Locale, key: MessageKey, parameters?: MessageParameters): string {
  return formatMessage(messageCatalogs[locale][key], parameters);
}

export function useI18n(): Translator {
  const locale = useSettingsStore((state) => state.locale);

  return useMemo(() => createCatalogTranslator(messageCatalogs[locale], locale), [locale]);
}
