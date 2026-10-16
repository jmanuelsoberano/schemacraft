import { describe, expect, it } from "vitest";

import { INSPECTOR_WIDTH_LIMITS, SIDEBAR_WIDTH_LIMITS } from "@/shared/settings/settingsStore";

import { MIN_CANVAS_WIDTH, fitSidePanels } from "./sidePanelWidths";
import type { SidePanel } from "./sidePanelWidths";

/** The narrowest window the desktop shell allows (`minWidth` in tauri.conf.json). */
const MIN_WINDOW_WIDTH = 1024;

const sidebar = (width: number, isOpen = true): SidePanel => ({
  width,
  limits: SIDEBAR_WIDTH_LIMITS,
  isOpen,
});
const inspector = (width: number, isOpen = true): SidePanel => ({
  width,
  limits: INSPECTOR_WIDTH_LIMITS,
  isOpen,
});

describe("fitSidePanels", () => {
  it("leaves the chosen widths alone while they fit", () => {
    const fitted = fitSidePanels(sidebar(560), inspector(560), 1920);
    expect(fitted.sidebar).toEqual({ width: 560, limits: SIDEBAR_WIDTH_LIMITS });
    expect(fitted.inspector).toEqual({ width: 560, limits: INSPECTOR_WIDTH_LIMITS });
    expect(fitSidePanels(sidebar(280), inspector(360), MIN_WINDOW_WIDTH)).toMatchObject({
      sidebar: { width: 280 },
      inspector: { width: 360 },
    });
  });

  it("keeps the canvas in the narrowest window with both panels at their widest", () => {
    const fitted = fitSidePanels(sidebar(560), inspector(560), MIN_WINDOW_WIDTH);
    expect(fitted.sidebar.width + fitted.inspector.width).toBe(MIN_WINDOW_WIDTH - MIN_CANVAS_WIDTH);
    // The entities panel gives way first, down to its minimum; the Inspector gives the rest.
    expect(fitted.inspector).toEqual({
      width: 484,
      limits: { ...INSPECTOR_WIDTH_LIMITS, max: 484 },
    });
    expect(fitted.sidebar).toEqual({
      width: SIDEBAR_WIDTH_LIMITS.min,
      limits: { ...SIDEBAR_WIDTH_LIMITS, max: SIDEBAR_WIDTH_LIMITS.min },
    });
  });

  it("gives the Inspector its width first and the entities panel what is left", () => {
    const fitted = fitSidePanels(sidebar(560), inspector(360), MIN_WINDOW_WIDTH);
    expect(fitted.inspector.width).toBe(360);
    expect(fitted.sidebar).toEqual({
      width: 344,
      limits: { ...SIDEBAR_WIDTH_LIMITS, max: 344 },
    });
  });

  it("gives a closed panel no room", () => {
    expect(fitSidePanels(sidebar(560), inspector(560, false), MIN_WINDOW_WIDTH).sidebar).toEqual({
      width: 560,
      limits: SIDEBAR_WIDTH_LIMITS,
    });
    expect(fitSidePanels(sidebar(560, false), inspector(560), MIN_WINDOW_WIDTH).inspector).toEqual({
      width: 560,
      limits: INSPECTOR_WIDTH_LIMITS,
    });
  });

  it("never takes a panel below its minimum, however narrow the window", () => {
    const fitted = fitSidePanels(sidebar(400), inspector(400), 600);
    expect(fitted.sidebar.width).toBe(SIDEBAR_WIDTH_LIMITS.min);
    expect(fitted.inspector.width).toBe(INSPECTOR_WIDTH_LIMITS.min);
  });
});
