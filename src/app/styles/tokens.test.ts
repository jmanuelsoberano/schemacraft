import { describe, expect, it } from "vitest";

import { DIAGRAM_PALETTES, PALETTE_TOKENS } from "@/features/export/svg/palette";
import type { DiagramPalette, ExportTheme } from "@/features/export/svg/palette";

import tokensCss from "./tokens.css?raw";

/**
 * tokens.css is the one source of colour. The export palette is its sRGB conversion, checked
 * here, and every other stylesheet refers to tokens instead of writing colours of its own.
 */

/** Every stylesheet that must use tokens only, by path, as text. */
const STYLESHEETS = import.meta.glob<string>(["/src/**/*.module.css", "/src/viewer/viewer.css"], {
  query: "?raw",
  eager: true,
  import: "default",
});

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

const OKLCH = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)/gu;

/** The `oklch()` colours of a token's value, in writing order: one, or light then dark. */
function tokenColors(name: string): Oklch[] {
  const declaration = new RegExp(`^\\s*${name}:\\s*(.+);$`, "mu").exec(tokensCss);
  if (declaration?.[1] === undefined) {
    throw new Error(`${name} is not declared in tokens.css`);
  }
  return [...declaration[1].matchAll(OKLCH)].map((match) => ({
    lightness: match[2] === "%" ? Number(match[1]) / 100 : Number(match[1]),
    chroma: Number(match[3]),
    hue: Number(match[4]),
  }));
}

/** Linear sRGB to an 8-bit gamma-encoded channel. */
function channel(linear: number): string {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255)
    .toString(16)
    .padStart(2, "0");
}

/** OKLCH to sRGB hex, through OKLab and the LMS matrices of the OKLab definition. */
function toHex({ lightness, chroma, hue }: Oklch): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** The light and dark sRGB values of a token: a `light-dark()` pair, or one colour for both. */
function tokenHex(name: string): Record<ExportTheme, string> {
  const [first, second] = tokenColors(name).map(toHex);
  if (first === undefined) {
    throw new Error(`${name} holds no oklch() colour`);
  }
  return { light: first, dark: second ?? first };
}

/** A written colour: `#hex` outside a `url(#id)`, or `oklch(` other than a relative colour. */
const RAW_COLOR = /(?<!\()#[0-9a-f]{3,8}\b|oklch\((?!from\s)/giu;

describe("the export palette", () => {
  it("is read from tokens.css", () => {
    expect(tokensCss).toContain("--color-canvas:");
    expect(tokensCss).toContain("--color-view:");
  });

  it("is the sRGB conversion of the tokens it names, in both themes", () => {
    for (const key of Object.keys(PALETTE_TOKENS) as (keyof DiagramPalette)[]) {
      expect({ light: DIAGRAM_PALETTES.light[key], dark: DIAGRAM_PALETTES.dark[key] }, key).toEqual(
        tokenHex(PALETTE_TOKENS[key]),
      );
    }
  });

  it("reproduces the conversion of known tokens", () => {
    expect(toHex({ lightness: 1, chroma: 0, hue: 0 })).toBe("#ffffff");
    expect(toHex({ lightness: 0, chroma: 0, hue: 0 })).toBe("#000000");
    expect(tokenHex("--color-accent")).toEqual({ light: "#5d5ddd", dark: "#7075ef" });
    expect(tokenHex("--color-on-accent")).toEqual({ light: "#fcfcfc", dark: "#fcfcfc" });
  });
});

describe("the other stylesheets", () => {
  const paths = Object.keys(STYLESHEETS);

  it("were all read", () => {
    expect(paths.length).toBeGreaterThanOrEqual(30);
    expect(paths).toContain("/src/viewer/viewer.css");
    expect(paths).toContain("/src/shared/ui/Alert.module.css");
    expect(paths.some((path) => path.endsWith("tokens.css"))).toBe(false);
    for (const path of paths) {
      expect(STYLESHEETS[path], path).toMatch(/\S/u);
    }
  });

  it("use tokens, never a colour of their own", () => {
    const offenders = paths.flatMap((path) => {
      const text = (STYLESHEETS[path] ?? "").replace(/\/\*[\s\S]*?\*\//gu, "");
      return [...text.matchAll(RAW_COLOR)].map((match) => `${path}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
