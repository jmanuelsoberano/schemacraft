import { isDesktopRuntime } from "@/shared/ipc/runtime";
import { useEffect } from "react";

import type { ActionId, AppAction } from "./action";
import { isApplePlatform, isReservedBrowserShortcut, matchesShortcut } from "./shortcut";

/** Whether keystrokes at `target` edit text, so plain keys and editing shortcuts belong to it. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Whether an open modal dialog (connection, export, unsaved changes, about, the palette) keeps
 * `actionId` from running, so no dialog ever opens on top of another. The palette toggle is the
 * one shortcut the palette itself leaves through, so Ctrl+K closes it again.
 */
function isBlockedByDialog(actionId: ActionId): boolean {
  for (const dialog of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    if (actionId === "view.commandPalette" && dialog.hasAttribute("data-command-palette")) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Routes keyboard shortcuts to their actions and swallows browser accelerators inside Tauri.
 * Listens in the capture phase, so no component can let a reload or a print reach the webview.
 */
export function useKeyboardShortcuts(actions: readonly AppAction[]): void {
  useEffect(() => {
    const applePlatform = isApplePlatform();
    const insideTauri = isDesktopRuntime();
    const allowDevtools = import.meta.env.DEV;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const reserved =
        insideTauri && isReservedBrowserShortcut(event, applePlatform, allowDevtools);
      if (event.repeat) {
        // A held key never repeats an action, but a held F5 must not reload the webview either.
        if (reserved) {
          event.preventDefault();
        }
        return;
      }

      const action = actions.find(
        (candidate) =>
          candidate.shortcut !== undefined &&
          matchesShortcut(event, candidate.shortcut, applePlatform),
      );

      if (action?.shortcut !== undefined) {
        // Plain keys must not fire while the user types in a field; modifier combos may,
        // unless the action leaves editing shortcuts such as undo to the field.
        const blocked =
          ((!action.shortcut.mod || action.skipWhenEditing === true) &&
            isEditableTarget(event.target)) ||
          isBlockedByDialog(action.id);
        if (blocked) {
          if (reserved) {
            event.preventDefault();
          }
          return;
        }
        event.preventDefault();
        if (action.isAvailable) {
          action.run();
        }
        return;
      }

      if (reserved) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [actions]);
}
