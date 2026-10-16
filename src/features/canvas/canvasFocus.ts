import { useCanvasUiStore } from "./canvasUiStore";

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

/**
 * Keeps focus on the canvas when the Inspector closes with focus inside it, from its own close
 * button or the toggle shortcut: focus goes back to the inspected card, or to the canvas, before
 * the panel turns inert and would drop it on the document. Returns the unsubscribe function.
 */
export function returnFocusFromInspector(): () => void {
  return useCanvasUiStore.subscribe((state, previous) => {
    if (previous.isInspectorOpen && !state.isInspectorOpen && isFocusInsideInspector()) {
      focusEntityNode(state.selectedKeys.length === 1 ? (state.selectedKeys[0] ?? null) : null);
    }
  });
}
