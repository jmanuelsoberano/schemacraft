/**
 * Colours of an exported diagram, resolved to sRGB hex because renderers outside the browser
 * understand neither `oklch()` nor `light-dark()`. Every value is the token of
 * `src/app/styles/tokens.css` named in {@link PALETTE_TOKENS}, converted through OKLab;
 * `src/app/styles/tokens.test.ts` redoes the conversion, so the two cannot drift apart.
 */
export type ExportTheme = "light" | "dark";

export interface DiagramPalette {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSubtle: string;
  accentText: string;
  warning: string;
  warningSubtle: string;
  warningText: string;
  view: string;
  viewSubtle: string;
  onView: string;
}

/** The custom property of tokens.css each palette entry is the conversion of. */
export const PALETTE_TOKENS: Readonly<Record<keyof DiagramPalette, string>> = {
  canvas: "--color-canvas",
  surface: "--color-surface",
  surfaceRaised: "--color-surface-raised",
  surfaceSunken: "--color-surface-sunken",
  border: "--color-border",
  borderStrong: "--color-border-strong",
  text: "--color-text",
  textSecondary: "--color-text-secondary",
  textMuted: "--color-text-muted",
  accent: "--color-accent",
  accentSubtle: "--color-accent-subtle",
  accentText: "--color-accent-text",
  warning: "--color-warning",
  warningSubtle: "--color-warning-subtle",
  warningText: "--color-warning-text",
  view: "--color-view",
  viewSubtle: "--color-view-subtle",
  onView: "--color-on-view",
};

export const DIAGRAM_PALETTES: Record<ExportTheme, DiagramPalette> = {
  light: {
    canvas: "#f6f7f9",
    surface: "#ffffff",
    surfaceRaised: "#ffffff",
    surfaceSunken: "#f1f2f5",
    border: "#dcdee3",
    borderStrong: "#c8cad3",
    text: "#1a1c26",
    textSecondary: "#525561",
    textMuted: "#777a85",
    accent: "#5d5ddd",
    accentSubtle: "#e6eaff",
    accentText: "#443dbb",
    warning: "#dc8900",
    warningSubtle: "#fff1d9",
    warningText: "#8e5400",
    view: "#007475",
    viewSubtle: "#e3f6f6",
    onView: "#fcfcfc",
  },
  dark: {
    canvas: "#101117",
    surface: "#191a20",
    surfaceRaised: "#22242b",
    surfaceSunken: "#0d0e13",
    border: "#2c2d34",
    borderStrong: "#40424a",
    text: "#e3e4ea",
    textSecondary: "#a2a4ac",
    textMuted: "#787a83",
    accent: "#7075ef",
    accentSubtle: "#272a4b",
    accentText: "#acb6ff",
    warning: "#f4a437",
    warningSubtle: "#331f05",
    warningText: "#f4a437",
    view: "#50bfbe",
    viewSubtle: "#112e2e",
    onView: "#061414",
  },
};

const PALETTE_KEYS = Object.keys(PALETTE_TOKENS) as (keyof DiagramPalette)[];

/** The `--sc-` property of a palette key, e.g. `surfaceSunken` becomes `--sc-surface-sunken`. */
export function viewerProperty(key: keyof DiagramPalette): string {
  return `--sc-${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * The palette as custom properties for the standalone viewer: the light values on `:root`, the
 * dark ones under `[data-theme="dark"]`. The exported page carries this block before the
 * viewer's stylesheet, which refers to colours through these properties only.
 */
export function viewerPaletteStyles(): string {
  const block = (selector: string, palette: DiagramPalette) =>
    `${selector}{${PALETTE_KEYS.map((key) => `${viewerProperty(key)}:${palette[key]};`).join("")}}`;
  return (
    block(":root", DIAGRAM_PALETTES.light) +
    block(':root[data-theme="dark"]', DIAGRAM_PALETTES.dark)
  );
}
