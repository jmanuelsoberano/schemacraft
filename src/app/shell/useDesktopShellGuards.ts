import { isDesktopRuntime } from "@/shared/ipc/runtime";
import { useEffect } from "react";

import { isEditableTarget } from "@/app/actions/useKeyboardShortcuts";

/**
 * Inside the desktop shell the webview behaves like an application, not a web page: no browser
 * context menu outside text fields (the diagram and the entities panel open their own), no
 * middle-click autoscroll, no dragging of images or links out of the window. A plain browser
 * keeps its defaults, so the development preview stays easy to inspect.
 */
export function useDesktopShellGuards(): void {
  useEffect(() => {
    if (!isDesktopRuntime()) {
      return undefined;
    }
    const suppressContextMenu = (event: MouseEvent) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    };
    const suppressAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };
    const suppressDrag = (event: DragEvent) => {
      if (!isEditableTarget(event.target)) {
        event.preventDefault();
      }
    };
    window.addEventListener("contextmenu", suppressContextMenu, true);
    window.addEventListener("mousedown", suppressAutoscroll, true);
    window.addEventListener("dragstart", suppressDrag, true);
    return () => {
      window.removeEventListener("contextmenu", suppressContextMenu, true);
      window.removeEventListener("mousedown", suppressAutoscroll, true);
      window.removeEventListener("dragstart", suppressDrag, true);
    };
  }, []);
}
