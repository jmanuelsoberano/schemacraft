/** Font a piece of diagram text is set in. */
export interface TextFont {
  family: "sans" | "mono";
  size: number;
  weight: 400 | 600;
}

/** Width in CSS pixels of `text` set in `font`. */
export type TextMeasurer = (text: string, font: TextFont) => number;

/** Family names match the bundled fonts, so browsers and the Rust renderer pick the same faces. */
export const SANS_FONT_STACK = 'Inter, "Segoe UI", system-ui, sans-serif';
export const MONO_FONT_STACK = '"JetBrains Mono", Consolas, monospace';

export const ELLIPSIS = "…";

/**
 * Width estimate for environments without a canvas: JetBrains Mono advances 0.6 em per glyph,
 * Inter about 0.56 em on average for identifiers.
 */
export function estimateTextWidth(text: string, font: TextFont): number {
  const perGlyph = font.family === "mono" ? 0.6 : 0.56;
  return text.length * perGlyph * font.size;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Wraps one source line at whitespace where possible, preserving every literal character. */
export function wrapTextLine(text: string, maxWidth: number, font: TextFont): string[] {
  const characters = Array.from(graphemes.segment(text), (item) => item.segment);
  if (characters.length === 0) return [""];
  const widths = characters.map((character) => estimateTextWidth(character, font));
  const lines: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = start;
    let width = 0;
    let whitespaceEnd = start;
    while (end < characters.length) {
      const nextWidth = widths[end] ?? 0;
      if (end > start && width + nextWidth > maxWidth) break;
      width += nextWidth;
      if (/\s/u.test(characters[end] ?? "")) whitespaceEnd = end + 1;
      end += 1;
    }
    // Prefer a complete word; a long token falls back to complete grapheme clusters.
    const boundary = end < characters.length && whitespaceEnd > start ? whitespaceEnd : end;
    lines.push(characters.slice(start, boundary).join(""));
    start = boundary;
  }
  return lines;
}

function cssFont(font: TextFont): string {
  const family = font.family === "mono" ? MONO_FONT_STACK : SANS_FONT_STACK;
  return `${font.weight} ${font.size}px ${family}`;
}

/** A measurer backed by a 2D canvas, when the environment has one; `null` otherwise. */
export function createCanvasMeasurer(): TextMeasurer | null {
  if (typeof document === "undefined") {
    return null;
  }
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) {
    return null;
  }
  return (text, font) => {
    context.font = cssFont(font);
    return context.measureText(text).width;
  };
}

/** `text` when it fits in `maxWidth`, otherwise the longest prefix that fits with an ellipsis. */
export function fitText(
  text: string,
  maxWidth: number,
  font: TextFont,
  measure: TextMeasurer,
): string {
  if (measure(text, font) <= maxWidth) {
    return text;
  }
  const glyphs = Array.from(text);
  let low = 0;
  let high = glyphs.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = glyphs.slice(0, middle).join("") + ELLIPSIS;
    if (measure(candidate, font) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low === 0 ? ELLIPSIS : glyphs.slice(0, low).join("") + ELLIPSIS;
}

/** Escapes text for element content and attribute values. */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Formats a coordinate with at most two decimals and no trailing zeros. */
export function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}
