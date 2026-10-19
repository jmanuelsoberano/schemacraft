import { entityKey } from "@/features/schema/entities";
import { moduleKey } from "@/features/schema/modules";
import type { ModuleRef } from "@/features/schema/modules";

import { useCanvasUiStore } from "./canvasUiStore";
import { focusEntitiesSearch } from "./entitiesSearch";

/** Id of the Inspector's landmark, the panel the shell places on the other side of the canvas. */
export const INSPECTOR_LANDMARK_ID = "inspector";

/** Whether the focused element is inside the Inspector. */
export function isFocusInsideInspector(): boolean {
  return document.getElementById(INSPECTOR_LANDMARK_ID)?.contains(document.activeElement) ?? false;
}

/**
 * Moves focus to the card of `key` on the canvas, or to the canvas itself when nothing is
 * inspected or the card is not rendered (cards out of view are unmounted). React Flow pans to
 * a card that receives focus, so it comes into view by itself. This is the one place that
 * knows how React Flow names its elements.
 */
export function focusEntityNode(key: string | null): void {
  const card =
    key === null
      ? null
      : document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(key)}"]`);
  (card ?? document.querySelector<HTMLElement>(".react-flow"))?.focus();
}

/** Modules return to their row, or to the parent's card for a trigger. */
export function focusInspectedHome(
  selectedKeys: readonly string[],
  module: ModuleRef | null,
): void {
  if (module === null) {
    focusEntityNode(selectedKeys.length === 1 ? (selectedKeys[0] ?? null) : null);
    return;
  }
  const target =
    module.kind === "trigger"
      ? document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(entityKey(module.parent))}"]`,
        )
      : document.querySelector<HTMLElement>(`[data-module-key="${CSS.escape(moduleKey(module))}"]`);
  if (target !== null && target.closest("[inert]") === null) {
    target.focus();
  } else {
    // A collapsed sidebar stays mounted but inert. Its search helper opens it before focusing.
    focusEntitiesSearch();
  }
}

/**
 * Keeps focus on the canvas when the Inspector closes with focus inside it, from its own close
 * button or the toggle shortcut: focus goes back to the inspected card, or to the canvas, before
 * the panel turns inert and would drop it on the document. Returns the unsubscribe function.
 */
export function returnFocusFromInspector(): () => void {
  return useCanvasUiStore.subscribe((state, previous) => {
    if (previous.isInspectorOpen && !state.isInspectorOpen && isFocusInsideInspector()) {
      focusInspectedHome(state.selectedKeys, state.selectedModule);
    }
  });
}
