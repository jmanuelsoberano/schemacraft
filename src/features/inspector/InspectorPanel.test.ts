import { Tooltip } from "radix-ui";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

// The panel reads the project store, which reaches the Tauri wrappers the node environment
// cannot provide, and the translator, which reads the persisted settings; a stand-in holds the
// project a test opens, and English is enough.
const projectState = vi.hoisted((): { project: unknown } => ({ project: null }));
vi.mock("@/features/project/projectStore", () => ({
  useProjectStore: (select: (state: typeof projectState) => unknown) => select(projectState),
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
const { InspectorSection } = await import("./InspectorSections");

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

/** The elements of `node`, depth first, the ones nested in their children included. */
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => elements(child));
  }
  return isValidElement<ElementProps>(node) ? [node, ...elements(node.props.children)] : [];
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

  it("mounts the sections of each inspected entity afresh, so a rule item never keeps another's state", () => {
    projectState.project = {
      content: {
        snapshot: previewSnapshot("Shop", "full"),
        canvas: { nodes: [] },
        inspection: {
          schemas: [],
          includeViews: true,
          includeProgrammability: true,
          includeModuleDefinitions: true,
        },
      },
    };
    try {
      const sections = elements(renderedPanel()).filter(
        (element) => element.type === InspectorSection,
      );
      expect(sections.length).toBeGreaterThan(0);
      // Two tables' CHECKs may share a name, so a section keyed by its kind alone would hand
      // one table's rule items, with their state, to the next table selected.
      for (const section of sections) {
        expect(section.key).toMatch(/^sales\.Orders:/u);
      }
    } finally {
      projectState.project = null;
    }
  });
});
