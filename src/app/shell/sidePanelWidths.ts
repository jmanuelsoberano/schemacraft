import { useSyncExternalStore } from "react";

import type { PanelWidthLimits } from "@/shared/ui/PanelResizer";

/** The narrowest the canvas gets between the two side panels, while their minimums allow it. */
export const MIN_CANVAS_WIDTH = 320;

/** A side panel as the user left it. */
export interface SidePanel {
  /** The width the user chose, already within `limits`; it is remembered as it is. */
  width: number;
  limits: PanelWidthLimits;
  isOpen: boolean;
}

/** A side panel as the window holds it: the width it takes and the widest it may take now. */
export interface FittedSidePanel {
  width: number;
  limits: PanelWidthLimits;
}

/** Caps a panel at `room`, never below its own minimum. */
function fitPanel(panel: SidePanel, room: number): FittedSidePanel {
  const max = Math.max(panel.limits.min, Math.min(panel.limits.max, Math.floor(room)));
  return { width: Math.min(panel.width, max), limits: { ...panel.limits, max } };
}

/**
 * The widths the entities panel and the Inspector take in a window `windowWidth` wide. Two wide
 * panels in a narrow window would push the canvas, the Inspector's close button and the top
 * bar's toggles out of the window, so together they leave the canvas {@link MIN_CANVAS_WIDTH}.
 * The Inspector keeps its width first, because it is the panel opened to be read, and yields
 * only down to its minimum; the entities panel takes what is left. The chosen widths are not
 * changed, so both come back when the window grows again, and a closed panel takes no room.
 */
export function fitSidePanels(
  sidebar: SidePanel,
  inspector: SidePanel,
  windowWidth: number,
): { sidebar: FittedSidePanel; inspector: FittedSidePanel } {
  const room = windowWidth - MIN_CANVAS_WIDTH;
  const fittedInspector = fitPanel(inspector, room - (sidebar.isOpen ? sidebar.limits.min : 0));
  const fittedSidebar = fitPanel(sidebar, room - (inspector.isOpen ? fittedInspector.width : 0));
  return { sidebar: fittedSidebar, inspector: fittedInspector };
}

function subscribeToResize(onResize: () => void): () => void {
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
  };
}

function readWindowWidth(): number {
  return window.innerWidth;
}

/** The width of the window, kept current while it is resized. */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToResize, readWindowWidth);
}
