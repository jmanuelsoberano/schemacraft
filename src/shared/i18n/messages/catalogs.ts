import type { Locale } from "../locales";
import { englishMessages } from "./en";
import type { MessageCatalog } from "./en";
import { spanishMessages } from "./es";

export const messageCatalogs: Readonly<Record<Locale, MessageCatalog>> = {
  en: englishMessages,
  es: spanishMessages,
};
