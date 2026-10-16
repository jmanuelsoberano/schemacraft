import type { Locale } from "./locales";

/** A UTC timestamp from the Rust side as a local date, e.g. "15 Oct 2026" or "15 oct 2026". */
export function formatDate(timestamp: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(timestamp));
}

/** A UTC timestamp from the Rust side as a local date and time, e.g. "15 Oct 2026, 09:30". */
export function formatDateTime(timestamp: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}
