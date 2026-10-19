import { describe, expect, it } from "vitest";

import { ACTIVE_SUFFIX, renderDiagramSvg } from "@/features/export/svg/renderDiagram";
import type { CanvasState, Column, ForeignKey, SchemaSnapshot, Table } from "@/shared/contracts";

import viewerCss from "./viewer.css?raw";

/**
 * The viewer emphasises the relationships of the hovered or selected table by swapping each end
 * for the accent variant of its own marker. The swap lives in viewer.css, keyed on the ids the
 * renderer writes, so a marker the stylesheet does not know would lose its shape on hover.
 */

function column(name: string, isNullable = false): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: "int",
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

function table(name: string, columns: Column[], primaryKey: string): Table {
  return {
    name: { schema: "dbo", name },
    columns,
    primaryKey: { name: `PK_${name}`, columns: [primaryKey], isClustered: true },
    indexes: [],
    checkConstraints: [],
  };
}

function key(name: string, referencing: string, column: string): ForeignKey {
  return {
    name,
    referencingTable: { schema: "dbo", name: referencing },
    referencedTable: { schema: "dbo", name: "Customers" },
    columnPairs: [{ referencingColumn: column, referencedColumn: "CustomerId" }],
    onDelete: "noAction",
    onUpdate: "noAction",
    isEnabled: true,
  };
}

/** One key of each kind of end: required, optional and one-to-one. */
const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-16T18:00:00Z",
  tables: [
    table("Customers", [column("CustomerId")], "CustomerId"),
    table("Orders", [column("OrderId"), column("CustomerId")], "OrderId"),
    table("Visits", [column("VisitId"), column("CustomerId", true)], "VisitId"),
    table("Profiles", [column("CustomerId")], "CustomerId"),
  ],
  views: [],
  foreignKeys: [
    key("FK_Orders_Customers", "Orders", "CustomerId"),
    key("FK_Visits_Customers", "Visits", "CustomerId"),
    key("FK_Profiles_Customers", "Profiles", "CustomerId"),
  ],
};

const canvas: CanvasState = {
  detailLevel: "keys",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: snapshot.tables.map((item, index) => ({
    name: item.name,
    position: { x: index * 320, y: index % 2 === 0 ? 0 : 300 },
    isCollapsed: false,
    isHidden: false,
  })),
};

/** The marker ids the relationships use at one end, without repeats. */
function idsAt(svg: string, end: "marker-start" | "marker-end"): string[] {
  const pattern = new RegExp(`class="sc-relation[^"]*"[^>]* ${end}="url\\(#([a-z-]+)\\)"`, "gu");
  return [...new Set([...svg.matchAll(pattern)].map((match) => match[1] ?? ""))].sort();
}

/** The declarations of `viewer.css` for an active relationship whose `end` uses `id`. */
function activeRule(end: "marker-start" | "marker-end", id: string): string | undefined {
  const selector = `.sc-relation.sc-active[${end}="url(#${id})"]`;
  const start = viewerCss.indexOf(`${selector} {`);
  return start === -1
    ? undefined
    : viewerCss
        .slice(start + selector.length, viewerCss.indexOf("}", start))
        .replace(/[\s{]/gu, "");
}

describe("viewer.css", () => {
  const { svg } = renderDiagramSvg(
    { snapshot, canvas },
    { detailLevel: "keys", theme: "light", labels: { view: "VIEW", triggers: () => "" } },
  );

  it("takes its colors from the shared palette, with raw colors only in shadows", () => {
    const withoutShadows = viewerCss.replace(/(?:--sc-shadow|box-shadow):[^;]+;/gu, "");
    expect(withoutShadows).not.toMatch(
      /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color)\(/iu,
    );
  });

  it("is checked against every end the renderer draws", () => {
    expect(idsAt(svg, "marker-start")).toEqual(["sc-many", "sc-zero-or-one"]);
    expect(idsAt(svg, "marker-end")).toEqual(["sc-one", "sc-zero-or-one"]);
  });

  it("swaps each end of an active relationship for the accent variant of its own marker", () => {
    for (const end of ["marker-start", "marker-end"] as const) {
      for (const id of idsAt(svg, end)) {
        expect(activeRule(end, id), `${end} ${id}`).toBe(`${end}:url(#${id}${ACTIVE_SUFFIX});`);
        expect(svg).toContain(`<marker id="${id}${ACTIVE_SUFFIX}"`);
      }
    }
  });

  it("never sets one marker for every active end, which would drop a circle or a foot", () => {
    const rule = viewerCss.slice(
      viewerCss.indexOf(".sc-relation.sc-active {"),
      viewerCss.indexOf("}", viewerCss.indexOf(".sc-relation.sc-active {")),
    );
    expect(rule).toContain("stroke:");
    expect(rule).not.toContain("marker");
  });
});
