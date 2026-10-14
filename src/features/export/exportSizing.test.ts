import { describe, expect, it } from "vitest";

import {
  MAX_RASTER_SIDE,
  estimateFileBytes,
  fitsRasterLimit,
  formatBytes,
  largestScaleWithinLimit,
  pageSizeMillimetres,
  rasterSize,
} from "./exportSizing";

const extent = { width: 1_920, height: 1_080, entityCount: 8, relationCount: 8 };

describe("export sizing", () => {
  it("scales raster sizes and enforces the limit", () => {
    expect(rasterSize(extent, 2)).toEqual({ width: 3_840, height: 2_160 });
    expect(fitsRasterLimit(extent, 4)).toBe(true);
    const wide = { ...extent, width: 5_000 };
    expect(fitsRasterLimit(wide, 4)).toBe(false);
    expect(largestScaleWithinLimit(wide)).toBe(2);
    expect(largestScaleWithinLimit({ ...extent, width: MAX_RASTER_SIDE + 1 })).toBeNull();
  });

  it("converts the page to millimetres at 96 pixels per inch", () => {
    expect(pageSizeMillimetres({ ...extent, width: 960, height: 480 })).toEqual({
      width: 254,
      height: 127,
    });
  });

  it("estimates sizes that grow with the content", () => {
    const svg = estimateFileBytes("svg", extent, 1, false);
    expect(estimateFileBytes("svg", extent, 1, true)).toBeGreaterThan(svg);
    expect(estimateFileBytes("html", extent, 1, false)).toBeGreaterThan(svg);
    expect(estimateFileBytes("png", extent, 4, false)).toBeGreaterThan(
      estimateFileBytes("png", extent, 1, false),
    );
    expect(estimateFileBytes("pdf", extent, 1, false)).toBeGreaterThan(0);
  });

  it("formats byte counts for people", () => {
    expect(formatBytes(950, "en")).toBe("950 B");
    expect(formatBytes(480_000, "en")).toBe("480 KB");
    expect(formatBytes(1_234_567, "en")).toBe("1.2 MB");
    expect(formatBytes(1_234_567, "es")).toBe("1,2 MB");
  });
});
