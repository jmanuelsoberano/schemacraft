import type { Locale } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import type { MessageKey } from "@/shared/i18n/messages/en";

/**
 * The part of the application's catalogue an exported HTML file carries, chosen by key prefix:
 * the viewer's own chrome, the object details it shares with the Inspector, the entity words,
 * the detail levels, the names of index kinds and definition states, and the readable rules,
 * whose sentences say what a key's referential actions do.
 * The viewer imports only the types from here, so the catalogues stay out of its bundle.
 */
export const VIEWER_MESSAGE_PREFIXES = [
  "viewer.",
  "details.",
  "entity.",
  "viewMode.",
  "indexKind.",
  "definition.",
  "trigger.",
  "rule.",
] as const;

/** Single messages the viewer says in the application's words, outside the prefixes. */
export const VIEWER_SHARED_MESSAGE_KEYS = [
  "sidebar.search",
  "export.note.partial",
  "export.triggerLegend",
  "export.triggersNotRead",
  "export.triggersNotChecked",
] as const satisfies readonly MessageKey[];

type PrefixedViewerMessageKey = Extract<
  MessageKey,
  `${(typeof VIEWER_MESSAGE_PREFIXES)[number]}${string}`
>;

export type ViewerMessageKey =
  PrefixedViewerMessageKey | (typeof VIEWER_SHARED_MESSAGE_KEYS)[number];

/** The embedded subset, in one language. */
export type ViewerMessages = Readonly<Record<ViewerMessageKey, string>>;

export function isViewerMessageKey(key: string): key is ViewerMessageKey {
  return (
    VIEWER_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    (VIEWER_SHARED_MESSAGE_KEYS as readonly string[]).includes(key)
  );
}

/** The messages an export in `locale` embeds for its viewer. */
export function viewerMessages(locale: Locale): ViewerMessages {
  const subset: Partial<Record<ViewerMessageKey, string>> = {};
  for (const [key, message] of Object.entries(messageCatalogs[locale])) {
    if (isViewerMessageKey(key)) {
      subset[key] = message;
    }
  }
  return subset as ViewerMessages;
}
