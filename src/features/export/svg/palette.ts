/**
 * Colours of an exported diagram, resolved to sRGB hex because renderers outside the browser
 * understand neither `oklch()` nor `light-dark()`. The values are the tokens of
 * `src/app/styles/tokens.css` converted once; keep both in step.
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
}

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
  },
};
