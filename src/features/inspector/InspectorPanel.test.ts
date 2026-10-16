import { Tooltip } from "radix-ui";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The panel reads the project store, which reaches the Tauri wrappers the node environment
// cannot provide, and the translator, which reads the persisted settings; neither matters here.
vi.mock("@/features/project/projectStore", () => ({
  useProjectStore: (select: (state: { project: null }) => unknown) => select({ project: null }),
}));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { englishMessages } = await import("@/shared/i18n/messages/en");
  const translator = createCatalogTranslator(englishMessages, "en");
  return { useI18n: () => translator };
});
// A server render reads a store's initial state, so the selection comes from a stand-in.
vi.mock("@/features/canvas/canvasUiStore", () => ({
  useCanvasUiStore: (select: (state: object) => unknown) =>
    select({
      selectedKeys: ["sales.Orders"],
      inspectorFocusRequest: 0,
      closeInspector: () => undefined,
    }),
}));
vi.mock("@/features/canvas/canvasFocus", () => ({ focusEntityNode: vi.fn() }));

const { focusEntityNode } = await import("@/features/canvas/canvasFocus");
const { InspectorPanel } = await import("./InspectorPanel");

type KeyDownHandler = (event: {
  key: string;
  defaultPrevented: boolean;
  preventDefault: () => void;
}) => void;

interface ElementProps {
  role?: string;
  children?: ReactNode;
  onKeyDown?: KeyDownHandler;
}

function Probe({ report }: { report: (panel: ReactNode) => void }) {
  // Called as a function, the panel's hooks run inside the probe and its markup comes back as
  // elements whose handlers can be called.
  report(
    InspectorPanel({
      onShowAccessReport: () => undefined,
      resizer: createElement("div", { role: "separator" }),
    }),
  );
  return null;
}

/** The element tree the panel renders, without a DOM. */
function renderedPanel(): ReactElement<ElementProps> {
  const holder: { panel: ReactNode } = { panel: null };
  renderToString(
    createElement(
      Tooltip.Provider,
      null,
      createElement(Probe, {
        report: (panel) => {
          holder.panel = panel;
        },
      }),
    ),
  );
  if (!isValidElement<ElementProps>(holder.panel)) {
    throw new Error("the panel did not render");
  }
  return holder.panel;
}

function contains(node: ReactNode, matches: (props: ElementProps) => boolean): boolean {
  if (Array.isArray(node)) {
    return node.some((child: ReactNode) => contains(child, matches));
  }
  if (!isValidElement<ElementProps>(node)) {
    return false;
  }
  return matches(node.props) || contains(node.props.children, matches);
}

describe("InspectorPanel", () => {
  it("returns focus to the inspected card on Escape from anywhere in it, its resize handle included", () => {
    const panel = renderedPanel();

    // The handle the shell passes in sits inside the element that handles Escape.
    expect(contains(panel.props.children, (props) => props.role === "separator")).toBe(true);
    const preventDefault = vi.fn();
    panel.props.onKeyDown?.({ key: "Escape", defaultPrevented: false, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focusEntityNode).toHaveBeenCalledWith("sales.Orders");
  });
});
