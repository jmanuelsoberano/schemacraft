import { describe, expect, it } from "vitest";

import { estimateTextWidth, wrapTextLine } from "./text";

const font = { family: "sans" as const, size: 11, weight: 400 as const };

describe("literal note wrapping", () => {
  it("prefers spaces instead of splitting ordinary words, without trimming their separators", () => {
    const source = "A reviewed explanation stays readable across exported diagrams. ".repeat(30);
    const lines = wrapTextLine(source, 600, font);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(source);
    for (const line of lines.slice(0, -1)) expect(line).toMatch(/\s$/u);
    for (const line of lines) expect(estimateTextWidth(line, font)).toBeLessThanOrEqual(600);
    const whitespace = "  first\tsecond   third  ";
    expect(wrapTextLine(whitespace, 80, font).join("")).toBe(whitespace);
  });

  it("splits long tokens without losing characters or cutting emoji graphemes", () => {
    const emoji = "👩🏽‍💻";
    const family = "👨‍👩‍👧‍👦";
    const source = `${emoji.repeat(40)} ${family.repeat(20)} ${"a\u0301".repeat(180)} ${"X".repeat(1800)}`;
    const lines = wrapTextLine(source, 600, font);
    expect(lines.join("")).toBe(source);
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const boundaries = new Set([0]);
    let offset = 0;
    for (const item of segmenter.segment(source)) {
      offset += item.segment.length;
      boundaries.add(offset);
    }
    offset = 0;
    for (const line of lines) {
      offset += line.length;
      expect(boundaries.has(offset)).toBe(true);
      expect(estimateTextWidth(line, font)).toBeLessThanOrEqual(600);
    }
  });

  it("keeps an explicit empty source line available to the layout", () => {
    expect(wrapTextLine("", 600, font)).toEqual([""]);
    expect(wrapTextLine("Literal <script> & text", 600, font)).toEqual(["Literal <script> & text"]);
  });
});
