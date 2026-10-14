import { useRef, useState } from "react";

import { useI18n } from "@/shared/i18n/useI18n";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSettingsStore,
} from "@/shared/settings/settingsStore";
import { classNames } from "@/shared/ui/classNames";

import styles from "./SidebarResizer.module.css";

const KEYBOARD_STEP = 16;

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
}

/**
 * Handle on the edge of the entities panel: drag it to resize, use the arrow keys when it has
 * focus, double-click to return to the default width. The width is remembered across sessions.
 */
export function SidebarResizer() {
  const { t } = useI18n();
  const width = useSettingsStore((state) => state.sidebarWidth);
  const setWidth = useSettingsStore((state) => state.setSidebarWidth);
  const [isDragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);

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
      aria-label={t("sidebar.resize")}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      className={classNames(styles.resizer, isDragging && styles.active)}
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
        setWidth(current.startWidth + event.clientX - current.startX);
      }}
      onPointerUp={(event) => {
        endDrag(event.pointerId);
      }}
      onPointerCancel={(event) => {
        endDrag(event.pointerId);
      }}
      onDoubleClick={() => {
        setWidth(SIDEBAR_DEFAULT_WIDTH);
      }}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "ArrowRight") {
          next = width + KEYBOARD_STEP;
        } else if (event.key === "ArrowLeft") {
          next = width - KEYBOARD_STEP;
        } else if (event.key === "Home") {
          next = SIDEBAR_MIN_WIDTH;
        } else if (event.key === "End") {
          next = SIDEBAR_MAX_WIDTH;
        }
        if (next !== null) {
          event.preventDefault();
          setWidth(next);
        }
      }}
    />
  );
}
