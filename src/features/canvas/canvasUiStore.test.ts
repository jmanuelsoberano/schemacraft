import { beforeEach, describe, expect, it } from "vitest";

import { useCanvasUiStore } from "./canvasUiStore";

beforeEach(() => {
  useCanvasUiStore.setState({
    focusRequest: null,
    isInspectorOpen: false,
    inspectorFocusRequest: 0,
  });
});

describe("the Inspector", () => {
  it("starts closed, opens, closes and toggles", () => {
    const { openInspector, closeInspector, toggleInspector } = useCanvasUiStore.getState();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(false);
    openInspector();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(true);
    closeInspector();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(false);
    toggleInspector();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(true);
    toggleInspector();
    expect(useCanvasUiStore.getState().isInspectorOpen).toBe(false);
  });

  it("asks for focus only when the request says so", () => {
    const { openInspector, closeInspector, toggleInspector } = useCanvasUiStore.getState();
    openInspector();
    expect(useCanvasUiStore.getState().inspectorFocusRequest).toBe(0);
    openInspector({ focus: true });
    expect(useCanvasUiStore.getState().inspectorFocusRequest).toBe(1);
    closeInspector();
    // Toggling open from the keyboard focuses; toggling closed never does.
    toggleInspector({ focus: true });
    expect(useCanvasUiStore.getState().inspectorFocusRequest).toBe(2);
    toggleInspector({ focus: true });
    expect(useCanvasUiStore.getState()).toMatchObject({
      isInspectorOpen: false,
      inspectorFocusRequest: 2,
    });
  });
});

describe("focusEntity", () => {
  it("centres on the entity unless asked to select it where it is", () => {
    const { focusEntity } = useCanvasUiStore.getState();
    focusEntity("dbo.Orders");
    expect(useCanvasUiStore.getState().focusRequest).toEqual({
      key: "dbo.Orders",
      center: true,
      nonce: 1,
    });
    focusEntity("dbo.Orders", { center: false });
    expect(useCanvasUiStore.getState().focusRequest).toEqual({
      key: "dbo.Orders",
      center: false,
      nonce: 2,
    });
  });

  it("changes the nonce on every request, so the same entity can be focused twice", () => {
    const { focusEntity } = useCanvasUiStore.getState();
    focusEntity("dbo.Orders");
    focusEntity("dbo.Orders");
    expect(useCanvasUiStore.getState().focusRequest?.nonce).toBe(2);
  });
});
