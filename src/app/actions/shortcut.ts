export interface Shortcut {
  /** Key as reported by `KeyboardEvent.key`; letters in lower case, e.g. "b" or "F5". */
  key: string;
  /** Ctrl on Windows and Linux, Command on Apple platforms. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

export function isApplePlatform(userAgent: string = navigator.userAgent): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/** Human-readable form, e.g. "Ctrl+Shift+S" on Windows or "⇧⌘S" on macOS. */
export function formatShortcut(shortcut: Shortcut, applePlatform: boolean): string {
  const keyLabel = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;

  if (applePlatform) {
    const symbols: string[] = [];
    if (shortcut.alt) symbols.push("⌥");
    if (shortcut.shift) symbols.push("⇧");
    if (shortcut.mod) symbols.push("⌘");
    return [...symbols, keyLabel].join("");
  }

  const parts: string[] = [];
  if (shortcut.mod) parts.push("Ctrl");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  return [...parts, keyLabel].join("+");
}

export function matchesShortcut(
  event: ShortcutKeyboardEvent,
  shortcut: Shortcut,
  applePlatform: boolean,
): boolean {
  const modPressed = applePlatform ? event.metaKey : event.ctrlKey;
  const foreignModifierPressed = applePlatform ? event.ctrlKey : event.metaKey;

  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    modPressed === Boolean(shortcut.mod) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt) &&
    !foreignModifierPressed
  );
}

const RELOAD_AND_FIND_KEYS = ["F3", "F5", "F7"];
const DEVTOOLS_COMBINATIONS = ["i", "j", "c"];
/** With the mod key: reload, print, find, view source, bookmarks, history, downloads, tabs, zoom. */
const MOD_KEYS = ["r", "p", "f", "g", "u", "d", "h", "j", "l", "t", "w", "F4", "=", "+", "-"];

/**
 * Browser accelerators that make no sense inside a desktop application: reloading the webview
 * (with any modifier, so Ctrl+F5 and Shift+F5 count), printing, the browser's find bar, page
 * zoom, history navigation and, unless `allowDevtools`, the developer tools. Application
 * shortcuts are matched first, so an action may legitimately reuse one of these keys.
 */
export function isReservedBrowserShortcut(
  event: ShortcutKeyboardEvent,
  applePlatform: boolean,
  allowDevtools = false,
): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = applePlatform ? event.metaKey : event.ctrlKey;
  if (RELOAD_AND_FIND_KEYS.includes(key)) {
    return true;
  }
  if (
    !allowDevtools &&
    (key === "F12" || (mod && event.shiftKey && DEVTOOLS_COMBINATIONS.includes(key)))
  ) {
    return true;
  }
  if (event.altKey && (key === "ArrowLeft" || key === "ArrowRight" || key === "Home")) {
    return true;
  }
  return mod && (MOD_KEYS.includes(key) || (event.shiftKey && key === "Delete"));
}
