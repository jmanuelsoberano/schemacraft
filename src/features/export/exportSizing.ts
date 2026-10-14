import type { ExportFormat, PngScale } from "./exportSpecification";
import { PNG_SCALES } from "./exportSpecification";
import type { DiagramExtent } from "./svg/renderDiagram";

/** Longest side a PNG may have, in pixels; mirrors `MAX_RASTER_SIDE` on the Rust side. */
export const MAX_RASTER_SIDE = 16_384;

const CSS_PIXELS_PER_MILLIMETRE = 96 / 25.4;
/** Weight of the four embedded Latin font faces, base64 encoded (measured: about 125 KB). */
export const EMBEDDED_FONTS_BYTES = 125_000;
const VIEWER_BYTES = 70_000;

export interface PixelSize {
  width: number;
  height: number;
}

/** Pixel size of a PNG of the diagram at `scale`. */
export function rasterSize(extent: DiagramExtent, scale: PngScale): PixelSize {
  return { width: Math.ceil(extent.width * scale), height: Math.ceil(extent.height * scale) };
}

/** Whether a PNG at `scale` stays within the renderer's limit. */
export function fitsRasterLimit(extent: DiagramExtent, scale: PngScale): boolean {
  const size = rasterSize(extent, scale);
  return size.width <= MAX_RASTER_SIDE && size.height <= MAX_RASTER_SIDE;
}

/** The largest scale that stays within the limit, or `null` when even 1x is too large. */
export function largestScaleWithinLimit(extent: DiagramExtent): PngScale | null {
  let best: PngScale | null = null;
  for (const scale of PNG_SCALES) {
    if (fitsRasterLimit(extent, scale)) {
      best = scale;
    }
  }
  return best;
}

/** Size of the PDF page in millimetres (the diagram is laid out at 96 px per inch). */
export function pageSizeMillimetres(extent: DiagramExtent): PixelSize {
  return {
    width: Math.round(extent.width / CSS_PIXELS_PER_MILLIMETRE),
    height: Math.round(extent.height / CSS_PIXELS_PER_MILLIMETRE),
  };
}

/**
 * Rough size of the output file, for the dialog's summary. Vector formats grow with the number
 * of entities and relationships; the raster grows with the pixel count of a mostly flat image.
 */
export function estimateFileBytes(
  format: ExportFormat,
  extent: DiagramExtent,
  scale: PngScale,
  embedFonts: boolean,
): number {
  const vector = 1_200 + extent.entityCount * 1_400 + extent.relationCount * 350;
  switch (format) {
    case "svg":
      return vector + (embedFonts ? EMBEDDED_FONTS_BYTES : 0);
    case "html":
      return vector + VIEWER_BYTES + (embedFonts ? EMBEDDED_FONTS_BYTES : 0);
    case "pdf":
      return 60_000 + extent.entityCount * 900 + extent.relationCount * 200;
    case "png": {
      const size = rasterSize(extent, scale);
      return 2_000 + Math.round(size.width * size.height * 0.12);
    }
  }
}

/** `1.2 MB`, `480 KB`, `950 B`, in the given locale. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit] ?? "B"}`;
}
