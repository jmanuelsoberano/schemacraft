import { useRef, useState } from "react";

import styles from "./PanelResizer.module.css";
import { classNames } from "./classNames";

/** The widths a side panel may take, in pixels, and the one it starts with. */
export interface PanelWidthLimits {
  min: number;
  max: number;
  default: number;
}

const KEYBOARD_STEP = 16;

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
}

interface PanelResizerProps {
  /** Accessible name of the handle, e.g. "Resize the entities panel". */
  label: string;
  /**
   * The edge of the panel the handle sits on: `end` for a panel on the left of the window,
   * `start` for one on the right. Dragging or arrowing away from the panel widens it either way.
   */
  edge: "start" | "end";
  width: number;
  limits: PanelWidthLimits;
  /** Receives the width as dragged or stepped; the owner clamps and remembers it. */
  onWidthChange: (width: number) => void;
  /**
   * Runs on a double-click instead of reporting `limits.default`, for an owner whose limits are
   * narrowed by the window and who must still remember the panel's own default width.
   */
  onReset?: () => void;
  /** Id of the panel the handle resizes. */
  controls?: string;
}

/**
 * Handle on the edge of a side panel: drag it to resize, use the arrow keys when it has focus,
 * Home and End for the narrowest and widest, double-click to return to the default width.
 */
export function PanelResizer({
  label,
  edge,
  width,
  limits,
  onWidthChange,
  onReset,
  controls,
}: PanelResizerProps) {
  const [isDragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  // Moving the pointer or the arrows to the right widens a panel on the left and narrows one on the right.
  const direction = edge === "end" ? 1 : -1;

  const endDrag = (pointerId: number) => {
    if (drag.current?.pointerId === pointerId) {
      drag.current = null;
      setDragging(false);
      document.body.style.cursor = "";
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
      className={classNames(
        styles.resizer,
        edge === "end" ? styles.end : styles.start,
        isDragging && styles.active,
      )}
      data-resizing={isDragging ? "" : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.style.cursor = "col-resize";
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId !== event.pointerId) {
          return;
        }
        onWidthChange(current.startWidth + direction * (event.clientX - current.startX));
      }}
      onPointerUp={(event) => {
        endDrag(event.pointerId);
      }}
      onPointerCancel={(event) => {
        endDrag(event.pointerId);
      }}
      onDoubleClick={() => {
        if (onReset) {
          onReset();
        } else {
          onWidthChange(limits.default);
        }
      }}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "ArrowRight") {
          next = width + direction * KEYBOARD_STEP;
        } else if (event.key === "ArrowLeft") {
          next = width - direction * KEYBOARD_STEP;
        } else if (event.key === "Home") {
          next = limits.min;
        } else if (event.key === "End") {
          next = limits.max;
        }
        if (next !== null) {
          event.preventDefault();
          onWidthChange(next);
        }
      }}
    />
  );
}
