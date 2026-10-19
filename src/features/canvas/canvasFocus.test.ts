import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { moduleKey } from "@/features/schema/modules";
import type { ModuleRef } from "@/features/schema/modules";

const focusSearch = vi.hoisted(() => vi.fn());
vi.mock("./entitiesSearch", () => ({ focusEntitiesSearch: focusSearch }));

const { focusInspectedHome } = await import("./canvasFocus");

const query = vi.fn();
function focusable(inert = false) {
  return { focus: vi.fn(), closest: vi.fn(() => (inert ? {} : null)) };
}

beforeEach(() => {
  focusSearch.mockClear();
  query.mockReset();
  query.mockReturnValue(null);
  vi.stubGlobal("document", { querySelector: query });
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inspector return focus", () => {
  const routine: ModuleRef = { kind: "routine", name: { schema: "sales", name: "Reconcile" } };

  it("returns a routine to its visible row", () => {
    const row = focusable();
    query.mockReturnValue(row);
    focusInspectedHome([], routine);
    expect(query).toHaveBeenCalledWith(`[data-module-key="${moduleKey(routine)}"]`);
    expect(row.focus).toHaveBeenCalledOnce();
    expect(focusSearch).not.toHaveBeenCalled();
  });

  it("opens the Objects panel before focusing search when its mounted row is inert", () => {
    const row = focusable(true);
    query.mockReturnValue(row);
    focusInspectedHome([], routine);
    expect(row.focus).not.toHaveBeenCalled();
    expect(focusSearch).toHaveBeenCalledOnce();
  });

  it("uses the panel-opening search fallback for a collapsed or unpaged routine", () => {
    focusInspectedHome([], routine);
    expect(focusSearch).toHaveBeenCalledOnce();
  });

  it("returns a trigger to its parent's card and opens search when that card is not mounted", () => {
    const trigger: ModuleRef = {
      kind: "trigger",
      parent: { schema: "sales", name: "Orders" },
      name: "Audit",
    };
    const card = focusable();
    query.mockReturnValueOnce(card);
    focusInspectedHome([], trigger);
    expect(query).toHaveBeenCalledWith('.react-flow__node[data-id="sales.Orders"]');
    expect(card.focus).toHaveBeenCalledOnce();
    query.mockReturnValue(null);
    focusInspectedHome([], trigger);
    expect(focusSearch).toHaveBeenCalledOnce();
  });

  it("preserves the entity selection path to the canvas", () => {
    const card = focusable();
    query.mockReturnValueOnce(card);
    focusInspectedHome(["sales.Orders"], null);
    expect(card.focus).toHaveBeenCalledOnce();
    expect(focusSearch).not.toHaveBeenCalled();
  });
});
