import { describe, expect, it } from "vitest";

import { DIAGRAM_PALETTES, PALETTE_TOKENS, viewerPaletteStyles, viewerProperty } from "./palette";
import type { DiagramPalette } from "./palette";

const keys = Object.keys(PALETTE_TOKENS) as (keyof DiagramPalette)[];

describe("viewerPaletteStyles", () => {
  it("writes every palette colour as a --sc- property, light on :root and dark under the theme", () => {
    const css = viewerPaletteStyles();
    const [light = "", dark = ""] = css.split(':root[data-theme="dark"]');
    expect(light.startsWith(":root{")).toBe(true);
    expect(dark.startsWith("{")).toBe(true);
    for (const key of keys) {
      expect(light).toContain(`${viewerProperty(key)}:${DIAGRAM_PALETTES.light[key]};`);
      expect(dark).toContain(`${viewerProperty(key)}:${DIAGRAM_PALETTES.dark[key]};`);
    }
    expect(css).toContain("--sc-view:#007475;");
    expect(css).toContain("--sc-view:#50bfbe;");
  });

  it("names the properties in kebab case, the way the viewer stylesheet reads them", () => {
    expect(viewerProperty("canvas")).toBe("--sc-canvas");
    expect(viewerProperty("surfaceSunken")).toBe("--sc-surface-sunken");
    expect(viewerProperty("onView")).toBe("--sc-on-view");
    expect(viewerPaletteStyles()).toMatch(/^[^A-Z]*$/u);
  });
});

describe("DIAGRAM_PALETTES", () => {
  it("holds the same entries for both themes, one token each", () => {
    expect(Object.keys(DIAGRAM_PALETTES.light).sort()).toEqual([...keys].sort());
    expect(Object.keys(DIAGRAM_PALETTES.dark).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(DIAGRAM_PALETTES.light[key]).toMatch(/^#[0-9a-f]{6}$/u);
      expect(DIAGRAM_PALETTES.dark[key]).toMatch(/^#[0-9a-f]{6}$/u);
      expect(PALETTE_TOKENS[key]).toMatch(/^--color-[a-z-]+$/u);
    }
  });
});
