import { Tooltip } from "radix-ui";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleRef } from "@/features/schema/modules";
import type { SchemaSnapshot } from "@/shared/contracts";

import { previewSnapshot } from "@/shared/ipc/previewConnectionBackend";

// The panel reads the project store, which reaches the Tauri wrappers the node environment
// cannot provide, and the translator, which reads the persisted settings; a stand-in holds the
// project a test opens, and English is enough.
const projectState = vi.hoisted((): { project: unknown } => ({ project: null }));
const canvasState = vi.hoisted(() => ({
  selectedKeys: ["sales.Orders"],
  selectedModule: null as ModuleRef | null,
  inspectorFocusRequest: 0,
  closeInspector: vi.fn(),
  focusEntity: vi.fn(),
  openInspector: vi.fn(),
}));
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
  useCanvasUiStore: (select: (state: object) => unknown) => select(canvasState),
}));
vi.mock("@/features/canvas/canvasFocus", () => ({ focusInspectedHome: vi.fn() }));
vi.mock("./CodeViewer", () => ({
  CodeViewer: ({ text }: { text: string }) =>
    createElement("pre", { "data-code-viewer": true }, text),
}));

const { focusInspectedHome } = await import("@/features/canvas/canvasFocus");
const { InspectorPanel } = await import("./InspectorPanel");
const { InspectorSection } = await import("./InspectorSections");
const { ModuleSection } = await import("./ModuleSections");
const { DefinitionSection } = await import("./DefinitionSection");

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

function setProject(snapshot: SchemaSnapshot) {
  projectState.project = {
    content: {
      snapshot,
      canvas: { nodes: [] },
      inspection: {
        schemas: [],
        includeViews: true,
        includeProgrammability: true,
        includeModuleDefinitions: true,
      },
    },
  };
}

function markup(): string {
  return renderToString(
    createElement(
      Tooltip.Provider,
      null,
      createElement(InspectorPanel, { onShowAccessReport: () => undefined }),
    ),
  );
}

afterEach(() => {
  projectState.project = null;
  canvasState.selectedKeys = ["sales.Orders"];
  canvasState.selectedModule = null;
  vi.clearAllMocks();
});

describe("InspectorPanel", () => {
  it("returns focus to the inspected card on Escape from anywhere in it, its resize handle included", () => {
    const panel = renderedPanel();

    // The handle the shell passes in sits inside the element that handles Escape.
    expect(contains(panel.props.children, (props) => props.role === "separator")).toBe(true);
    const preventDefault = vi.fn();
    panel.props.onKeyDown?.({ key: "Escape", defaultPrevented: false, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focusInspectedHome).toHaveBeenCalledWith(["sales.Orders"], null);
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

  it("renders a module heading and sections, and returns Escape to its module home", () => {
    const ref: ModuleRef = { kind: "routine", name: { schema: "sales", name: "PlaceOrder" } };
    const snapshot = previewSnapshot("Shop", "full");
    snapshot.programmability = {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      views: [],
      triggers: [],
      routines: [
        {
          name: ref.name,
          kind: "procedure",
          parameters: [],
          returns: null,
          columns: [],
          body: {
            language: "sql",
            definition: { status: "readable", text: "SELECT '<img onerror=alert(1)>';" },
          },
        },
      ],
    };
    setProject(snapshot);
    canvasState.selectedKeys = [];
    canvasState.selectedModule = ref;
    expect(markup()).toContain("PlaceOrder");
    expect(markup()).toContain("Procedure");
    expect(markup()).toContain("&lt;img");
    expect(markup()).not.toContain("<img");
    const panel = renderedPanel();
    expect(elements(panel).filter((element) => element.type === ModuleSection)).toHaveLength(2);
    panel.props.onKeyDown?.({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn() });
    expect(focusInspectedHome).toHaveBeenCalledWith([], ref);
    vi.clearAllMocks();
    panel.props.onKeyDown?.({ key: "Escape", defaultPrevented: true, preventDefault: vi.fn() });
    expect(focusInspectedHome).not.toHaveBeenCalled();
  });

  it("shows a trigger's parent link and state without an empty code viewer", () => {
    const snapshot = previewSnapshot("Shop", "full");
    const ref: ModuleRef = {
      kind: "trigger",
      parent: { schema: "sales", name: "Orders" },
      name: "Audit",
    };
    snapshot.programmability = {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      views: [],
      routines: [],
      triggers: [
        {
          parent: ref.parent,
          name: ref.name,
          timing: "after",
          events: [{ event: "delete", order: "last" }],
          isEnabled: true,
          isNotForReplication: false,
          body: { language: "sql", definition: { status: "encrypted" } },
        },
      ],
    };
    setProject(snapshot);
    canvasState.selectedKeys = [];
    canvasState.selectedModule = ref;
    const html = markup();
    expect(html).toContain('aria-label="Go to sales.Orders"');
    expect(html).toContain("Encrypted on the server");
    expect(html).toContain("TRUNCATE TABLE");
    expect(html).not.toContain("data-code-viewer");
  });

  it("appends view code after entity sections only in the desktop Inspector", () => {
    const snapshot = previewSnapshot("Shop", "full");
    delete snapshot.programmability;
    const view = snapshot.views[0];
    if (view === undefined) throw new Error("view fixture missing");
    setProject(snapshot);
    canvasState.selectedKeys = [`${view.name.schema}.${view.name.name}`];
    const sections = elements(renderedPanel()).filter(
      (element) => element.type === InspectorSection || element.type === DefinitionSection,
    );
    expect(sections[0]?.type).toBe(InspectorSection);
    expect(sections.at(-1)?.type).toBe(DefinitionSection);
    expect(markup()).toContain("Not recorded in this project");
  });
});
