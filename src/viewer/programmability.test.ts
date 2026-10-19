import { describe, expect, it, vi } from "vitest";

import { visibleProjection } from "@/features/export/html/viewerData";
import { viewerMessages } from "@/features/export/html/viewerMessages";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import { presentObjectDetails } from "@/features/schema/objectDetailsView";
import type { DetailsView } from "@/features/schema/objectDetailsView";
import type { CanvasState, SchemaSnapshot } from "@/shared/contracts";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import { triggerList, viewDefinition } from "./programmability";

interface ElementTree {
  tag: string;
  attributes: Record<string, string | boolean | undefined>;
  children: (ElementTree | string)[];
}

// Keep text separate from element markup, as h does with Element.append in the browser.
vi.mock("./dom", () => ({
  h: (
    tag: string,
    attributes: ElementTree["attributes"],
    ...children: (ElementTree | string | null)[]
  ) => ({
    tag,
    attributes,
    children: children.filter((child) => child !== null),
  }),
}));

function elements(node: ElementTree): ElementTree[] {
  return [
    node,
    ...node.children.flatMap((child) => (typeof child === "string" ? [] : elements(child))),
  ];
}

function text(node: ElementTree): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

const hostileName = '</script><img src=x onerror="alert(1)">';
const snapshot: SchemaSnapshot = {
  databaseName: "Example",
  serverVersion: null,
  extractedAt: "2026-10-19T12:00:00Z",
  tables: [],
  views: [{ name: { schema: "dbo", name: "RecentOrders" }, columns: [] }],
  foreignKeys: [],
  programmability: {
    capture: { objects: { status: "read" }, definitions: { status: "read" } },
    routines: [],
    views: [
      {
        view: { schema: "dbo", name: "RecentOrders" },
        definition: { status: "readable", text: "PRIVATE_SQL_SENTINEL" },
        hasCheckOption: true,
        isIndexed: true,
      },
    ],
    triggers: [
      {
        parent: { schema: "dbo", name: "RecentOrders" },
        name: hostileName,
        timing: "insteadOf",
        events: [
          { event: "insert", order: "first" },
          { event: "update", order: "last" },
        ],
        isEnabled: false,
        isNotForReplication: true,
        body: { language: "sql", definition: { status: "readable", text: "PRIVATE_SQL_SENTINEL" } },
      },
    ],
  },
};

const canvas: CanvasState = {
  detailLevel: "full",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      name: { schema: "dbo", name: "RecentOrders" },
      position: { x: 0, y: 0 },
      isHidden: false,
      isCollapsed: false,
    },
  ],
};

function detailView(source = snapshot): DetailsView {
  const projected = visibleProjection(source, canvas);
  const facts = describeObjectDetails(projected.snapshot, "dbo.RecentOrders", {
    hiddenKeys: new Set(),
    coverage: projected.access?.coverage ?? null,
    carriedOver: projected.carriedOver,
    isSchemaFiltered: false,
    isDiagramOnly: true,
    definitions: "excluded",
  });
  if (facts === null) throw new Error("Expected visible view details");
  return presentObjectDetails(facts, createCatalogTranslator(viewerMessages("en"), "en"));
}

describe("standalone programmable-object details", () => {
  it("renders trigger metadata as text, with per-event order and without an app-only link", () => {
    const section = detailView().sections.find((section) => section.kind === "triggers");
    if (section?.kind !== "triggers") throw new Error("Expected trigger section");
    const rendered = triggerList(section) as unknown as ElementTree;
    const content = text(rendered);
    expect(content).toContain(hostileName);
    expect(content).toContain("Configured to run instead of INSERT.");
    expect(content).toContain("First on INSERT");
    expect(content).toContain("Last on UPDATE");
    expect(content).toContain("Disabled");
    expect(content).toContain("NOT FOR REPLICATION");
    expect(content).not.toContain("PRIVATE_SQL_SENTINEL");
    expect(content).not.toContain("Open trigger");
    for (const tag of ["img", "script", "button", "a", "pre"]) {
      expect(elements(rendered).map((node) => node.tag)).not.toContain(tag);
    }
    expect(
      elements(rendered).some((node) =>
        Object.keys(node.attributes).some((key) => key.startsWith("on")),
      ),
    ).toBe(false);
  });

  it.each(["captured", "legacy"] as const)(
    "explains excluded view definitions in a %s file, without an empty source control",
    (kind) => {
      const source = kind === "captured" ? snapshot : { ...snapshot, programmability: undefined };
      const section = detailView(source).sections.find(
        (section) => section.kind === "viewDefinition",
      );
      if (section?.kind !== "viewDefinition") throw new Error("Expected definition section");
      const rendered = viewDefinition(section) as unknown as ElementTree;
      expect(text(rendered)).toContain("Not included in this file");
      expect(text(rendered)).not.toContain("PRIVATE_SQL_SENTINEL");
      for (const tag of ["pre", "code", "button", "details"]) {
        expect(elements(rendered).map((node) => node.tag)).not.toContain(tag);
      }
      if (kind === "captured") {
        expect(text(rendered)).toContain("WITH CHECK OPTION");
        expect(text(rendered)).toContain("Indexed view");
      }
    },
  );
});
