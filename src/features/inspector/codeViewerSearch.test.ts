import { describe, expect, it } from "vitest";
import { codeLines, codeMatches, codePosition, nextCodeMatch } from "./codeViewerSearch";

describe("read-only code search", () => {
  it("keeps CRLF, lone CR, blank lines and trailing spaces verbatim", () => {
    const text = "SELECT 1;  \r\n\rSELECT 2;\n";
    const lines = codeLines(text);
    expect(lines.map((line) => line.text).join("")).toBe(text);
    expect(lines.map((line) => line.text)).toEqual(["SELECT 1;  \r\n", "\r", "SELECT 2;\n", ""]);
    expect(codeLines("")).toEqual([{ text: "", start: 0 }]);
  });
  it("finds literal text without regex metacharacters or shifted Unicode offsets", () => {
    const text = "İ. SELECT [a]]b] SELECT N'<script>'";
    expect(codeMatches(text, "select")).toEqual([
      { start: 3, end: 9 },
      { start: 17, end: 23 },
    ]);
    expect(codeMatches(text, "[a]]b]")).toEqual([{ start: 10, end: 16 }]);
    expect(codeMatches(text, ".")).toEqual([{ start: 1, end: 2 }]);
    expect(codeMatches(text, "")).toEqual([]);
  });
  it("maps range offsets across original line ends and wraps match navigation", () => {
    const lines = codeLines("a\r\nb\rc\n");
    expect(codePosition(lines, 3)).toEqual({ line: 1, offset: 0 });
    expect(codePosition(lines, 4)).toEqual({ line: 1, offset: 1 });
    expect(codePosition(lines, 7)).toEqual({ line: 3, offset: 0 });
    expect(nextCodeMatch(2, 3, false)).toBe(0);
    expect(nextCodeMatch(0, 3, true)).toBe(2);
    expect(nextCodeMatch(0, 0, true)).toBe(0);
  });
});
