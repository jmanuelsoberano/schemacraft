import { describe, expect, it } from "vitest";

import {
  formatShortcut,
  isApplePlatform,
  isReservedBrowserShortcut,
  matchesShortcut,
} from "./shortcut";
import type { ShortcutKeyboardEvent } from "./shortcut";

function keyboardEvent(overrides: Partial<ShortcutKeyboardEvent>): ShortcutKeyboardEvent {
  return { key: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides };
}

describe("formatShortcut", () => {
  it("spells modifiers out on Windows", () => {
    expect(formatShortcut({ mod: true, key: "b" }, false)).toBe("Ctrl+B");
    expect(formatShortcut({ mod: true, shift: true, key: "l" }, false)).toBe("Ctrl+Shift+L");
    expect(formatShortcut({ key: "F5" }, false)).toBe("F5");
  });

  it("uses symbols on Apple platforms", () => {
    expect(formatShortcut({ mod: true, key: "b" }, true)).toBe("⌘B");
    expect(formatShortcut({ mod: true, shift: true, key: "l" }, true)).toBe("⇧⌘L");
  });
});

describe("matchesShortcut", () => {
  it("maps the mod key to Ctrl on Windows and to Command on Apple platforms", () => {
    const control = keyboardEvent({ key: "b", ctrlKey: true });
    const command = keyboardEvent({ key: "b", metaKey: true });
    expect(matchesShortcut(control, { mod: true, key: "b" }, false)).toBe(true);
    expect(matchesShortcut(command, { mod: true, key: "b" }, false)).toBe(false);
    expect(matchesShortcut(command, { mod: true, key: "b" }, true)).toBe(true);
  });

  it("requires every modifier to match exactly", () => {
    const event = keyboardEvent({ key: "L", ctrlKey: true, shiftKey: true });
    expect(matchesShortcut(event, { mod: true, shift: true, key: "l" }, false)).toBe(true);
    expect(matchesShortcut(event, { mod: true, key: "l" }, false)).toBe(false);
  });

  it("matches function keys without modifiers", () => {
    expect(matchesShortcut(keyboardEvent({ key: "F5" }), { key: "F5" }, false)).toBe(true);
    expect(matchesShortcut(keyboardEvent({ key: "F5", ctrlKey: true }), { key: "F5" }, false)).toBe(
      false,
    );
  });
});

describe("isReservedBrowserShortcut", () => {
  it("recognises reload and print accelerators", () => {
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "F5" }), false)).toBe(true);
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "r", ctrlKey: true }), false)).toBe(true);
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "b", ctrlKey: true }), false)).toBe(
      false,
    );
  });
});

describe("isApplePlatform", () => {
  it("detects Apple user agents", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});

describe("isReservedBrowserShortcut with modifiers and developer tools", () => {
  it("treats every reload combination as reserved", () => {
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "F5", ctrlKey: true }), false)).toBe(
      true,
    );
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "F5", shiftKey: true }), false)).toBe(
      true,
    );
    expect(
      isReservedBrowserShortcut(keyboardEvent({ key: "R", ctrlKey: true, shiftKey: true }), false),
    ).toBe(true);
  });

  it("keeps the developer tools only when asked to", () => {
    const f12 = keyboardEvent({ key: "F12" });
    const inspect = keyboardEvent({ key: "I", ctrlKey: true, shiftKey: true });
    expect(isReservedBrowserShortcut(f12, false)).toBe(true);
    expect(isReservedBrowserShortcut(inspect, false)).toBe(true);
    expect(isReservedBrowserShortcut(f12, false, true)).toBe(false);
    expect(isReservedBrowserShortcut(inspect, false, true)).toBe(false);
  });

  it("covers history navigation, zoom and the find bar but not application keys", () => {
    expect(
      isReservedBrowserShortcut(keyboardEvent({ key: "ArrowLeft", altKey: true }), false),
    ).toBe(true);
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "=", ctrlKey: true }), false)).toBe(true);
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "f", ctrlKey: true }), false)).toBe(true);
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "e", ctrlKey: true }), false)).toBe(
      false,
    );
    expect(isReservedBrowserShortcut(keyboardEvent({ key: "ArrowLeft" }), false)).toBe(false);
  });
});
