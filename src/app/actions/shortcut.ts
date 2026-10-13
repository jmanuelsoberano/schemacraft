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

/**
 * Browser accelerators that make no sense inside a desktop application, such as reloading the
 * webview with F5 or opening the print dialog with Ctrl+P.
 */
const RESERVED_BROWSER_SHORTCUTS: readonly Shortcut[] = [
  { key: "F5" },
  { key: "F3" },
  { key: "F7" },
  { mod: true, key: "r" },
  { mod: true, key: "p" },
  { mod: true, key: "f" },
  { mod: true, key: "g" },
  { mod: true, key: "u" },
];

export function isReservedBrowserShortcut(
  event: ShortcutKeyboardEvent,
  applePlatform: boolean,
): boolean {
  return RESERVED_BROWSER_SHORTCUTS.some((shortcut) =>
    matchesShortcut(event, shortcut, applePlatform),
  );
}
