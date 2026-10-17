import { beforeEach, describe, expect, it } from "vitest";

import { useCanvasUiStore } from "./canvasUiStore";
import type { RuleHighlight } from "./canvasUiStore";

beforeEach(() => {
  useCanvasUiStore.setState({
    focusRequest: null,
    isInspectorOpen: false,
    inspectorFocusRequest: 0,
    selectedKeys: [],
    ruleHighlight: null,
  });
});

function highlight(owner: string, edgeId: string | null = null): RuleHighlight {
  return { owner, columns: new Map([["sales.Orders", new Set(["Status"])]]), edgeId };
}

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

describe("the rule highlight", () => {
  it("is replaced by the rule pointed at last and cleared only by the rule that set it", () => {
    const { setRuleHighlight, clearRuleHighlight } = useCanvasUiStore.getState();
    setRuleHighlight(highlight("check"));
    const key = highlight("key", "sales.Orders.FK_Orders_Customers");
    setRuleHighlight(key);
    expect(useCanvasUiStore.getState().ruleHighlight).toBe(key);
    // The item the pointer left a moment ago, or one that unmounts, leaves the newer one alone.
    clearRuleHighlight("check");
    expect(useCanvasUiStore.getState().ruleHighlight).toBe(key);
    clearRuleHighlight("key");
    expect(useCanvasUiStore.getState().ruleHighlight).toBeNull();
  });

  it("goes with the Inspector and with the entity it was shown for", () => {
    const { setRuleHighlight, closeInspector, setSelectedKeys, openInspector } =
      useCanvasUiStore.getState();
    openInspector();
    setRuleHighlight(highlight("check"));
    closeInspector();
    expect(useCanvasUiStore.getState().ruleHighlight).toBeNull();

    setSelectedKeys(["sales.Orders"]);
    setRuleHighlight(highlight("check"));
    // Telling the store the selection it has keeps the highlight; another selection clears it.
    setSelectedKeys(["sales.Orders"]);
    expect(useCanvasUiStore.getState().ruleHighlight).not.toBeNull();
    setSelectedKeys(["dbo.Customers"]);
    expect(useCanvasUiStore.getState()).toMatchObject({
      selectedKeys: ["dbo.Customers"],
      ruleHighlight: null,
    });
  });
});
