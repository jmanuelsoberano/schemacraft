import { describe, expect, it } from "vitest";
import { codeViewerCommand } from "./codeViewerKeyboard";

const event = (key: string, modifiers = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});
describe("code viewer key map", () => {
  it("owns Escape only while finding and leaves Tab and global commands alone", () => {
    expect(codeViewerCommand(event("Escape"), false, true)).toBe("closeFind");
    expect(codeViewerCommand(event("Escape"), false, false)).toBeNull();
    for (const key of ["Tab", "F5", "F1", "z", "y", "k", "i", "g"])
      expect(codeViewerCommand(event(key, { ctrlKey: key.length === 1 }), false, true)).toBeNull();
  });
  it("recognizes the platform modifier without stealing modified alternatives", () => {
    expect(codeViewerCommand(event("f", { ctrlKey: true }), false, false)).toBe("find");
    expect(codeViewerCommand(event("a", { metaKey: true }), true, false)).toBe("selectAll");
    expect(codeViewerCommand(event("F3", { shiftKey: true }), false, false)).toBe("previous");
    expect(codeViewerCommand(event("F3", { ctrlKey: true }), false, false)).toBeNull();
    expect(
      codeViewerCommand(event("f", { ctrlKey: true, shiftKey: true }), false, false),
    ).toBeNull();
  });
});
