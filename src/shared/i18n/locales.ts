export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the first preferred language that the application supports, matching on the primary
 * language subtag so that "es-MX" or "en-GB" resolve to "es" and "en".
 */
export function detectInitialLocale(preferredLanguages: readonly string[]): Locale {
  for (const language of preferredLanguages) {
    const primarySubtag = language.toLowerCase().split("-")[0] ?? "";
    if (isSupportedLocale(primarySubtag)) {
      return primarySubtag;
    }
  }
  return DEFAULT_LOCALE;
}
