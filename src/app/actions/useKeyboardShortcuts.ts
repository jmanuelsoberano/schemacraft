import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

import type { AppAction } from "./action";
import { isApplePlatform, isReservedBrowserShortcut, matchesShortcut } from "./shortcut";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Routes keyboard shortcuts to their actions and swallows browser accelerators inside Tauri. */
export function useKeyboardShortcuts(actions: readonly AppAction[]): void {
  useEffect(() => {
    const applePlatform = isApplePlatform();
    const insideTauri = isTauri();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const action = actions.find(
        (candidate) =>
          candidate.shortcut !== undefined &&
          matchesShortcut(event, candidate.shortcut, applePlatform),
      );

      if (action?.shortcut !== undefined) {
        // Plain keys must not fire while the user types in a field; modifier combos may.
        if (!action.shortcut.mod && isEditableTarget(event.target)) {
          return;
        }
        event.preventDefault();
        if (action.isAvailable) {
          action.run();
        }
        return;
      }

      if (insideTauri && isReservedBrowserShortcut(event, applePlatform)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [actions]);
}
