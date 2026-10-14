import { describe, expect, it } from "vitest";

import type { CanvasState, Column, SchemaSnapshot } from "@/shared/contracts";

import { measureDiagram, renderDiagramSvg } from "./renderDiagram";
import { ELLIPSIS, estimateTextWidth, fitText } from "./text";

function column(name: string, typeName: string, isNullable = false): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: typeName,
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

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Customers" },
      columns: [
        column("CustomerId", "int"),
        column("Name", "nvarchar"),
        column("Email", "nvarchar", true),
      ],
      primaryKey: { name: "PK_Customers", columns: ["CustomerId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "Orders & <Lines>" },
      columns: [
        column("OrderId", "int"),
        column("CustomerId", "int"),
        column("SalesRepId", "int", true),
      ],
      primaryKey: { name: "PK_Orders", columns: ["OrderId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "hr", name: "Employees" },
      columns: [column("EmployeeId", "int"), column("ManagerId", "int", true)],
      primaryKey: { name: "PK_Employees", columns: ["EmployeeId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "Hidden" },
      columns: [column("Id", "int")],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [column("OrderId", "int")] }],
  foreignKeys: [
    {
      name: "FK_Orders_Customers",
      referencingTable: { schema: "sales", name: "Orders & <Lines>" },
      referencedTable: { schema: "dbo", name: "Customers" },
      columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
    {
      name: "FK_Orders_Employees",
      referencingTable: { schema: "sales", name: "Orders & <Lines>" },
      referencedTable: { schema: "hr", name: "Employees" },
      columnPairs: [{ referencingColumn: "SalesRepId", referencedColumn: "EmployeeId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: false,
    },
    {
      name: "FK_Employees_Manager",
      referencingTable: { schema: "hr", name: "Employees" },
      referencedTable: { schema: "hr", name: "Employees" },
      columnPairs: [{ referencingColumn: "ManagerId", referencedColumn: "EmployeeId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
    {
      name: "FK_Hidden_Customers",
      referencingTable: { schema: "dbo", name: "Hidden" },
      referencedTable: { schema: "dbo", name: "Customers" },
      columnPairs: [{ referencingColumn: "Id", referencedColumn: "CustomerId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
};

const canvas: CanvasState = {
  detailLevel: "keys",
  layout: "manual",
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      name: { schema: "dbo", name: "Customers" },
      position: { x: 100, y: 100 },
      isCollapsed: false,
      isHidden: false,
    },
    {
      name: { schema: "sales", name: "Orders & <Lines>" },
      position: { x: 500, y: 120 },
      isCollapsed: false,
      isHidden: false,
    },
    {
      name: { schema: "hr", name: "Employees" },
      position: { x: 500, y: 400 },
      isCollapsed: true,
      isHidden: false,
    },
    {
      name: { schema: "dbo", name: "Hidden" },
      position: { x: 900, y: 100 },
      isCollapsed: false,
      isHidden: true,
    },
    {
      name: { schema: "sales", name: "RecentOrders" },
      position: { x: 100, y: 400 },
      isCollapsed: false,
      isHidden: false,
    },
  ],
};

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("renderDiagramSvg", () => {
  it("draws the visible entities and the relationships between them", () => {
    const rendered = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light" },
    );
    expect(rendered.entityCount).toBe(4);
    expect(rendered.relationCount).toBe(3);
    expect(count(rendered.svg, 'class="sc-entity')).toBe(4);
    expect(count(rendered.svg, "data-relation=")).toBe(3);
    expect(rendered.svg).not.toContain("dbo.Hidden");
    expect(rendered.svg).toContain('data-entity="sales.Orders &amp; &lt;Lines&gt;"');
    expect(rendered.svg).toContain("<title>Shop</title>");
    expect(rendered.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(rendered.svg.endsWith("</svg>")).toBe(true);
    expect(count(rendered.svg, "<g")).toBe(count(rendered.svg, "</g>"));
  });

  it("sizes the document from the node boxes plus padding and the self-loop reach", () => {
    const extent = measureDiagram({ snapshot, canvas }, "keys", 48);
    // Nodes span x 100..740 (Orders at 500 + 240) plus the loop of Employees, y 100..438.
    expect(extent.width).toBe(740 - 100 + 44 + 4 + 48 * 2);
    expect(extent.height).toBe(400 + 38 - 100 + 48 * 2);
    const full = measureDiagram({ snapshot, canvas }, "full", 48);
    expect(full.height).toBeGreaterThan(extent.height);
    const compact = measureDiagram({ snapshot, canvas }, "compact", 48);
    expect(compact.height).toBeLessThan(full.height);
    expect(compact.height).toBeLessThanOrEqual(extent.height);
  });

  it("marks cardinality, disabled relationships and self-references", () => {
    const { svg } = renderDiagramSvg({ snapshot, canvas }, { detailLevel: "keys", theme: "light" });
    expect(svg).toContain('marker-start="url(#sc-many)" marker-end="url(#sc-one)"');
    expect(svg).toContain('marker-start="url(#sc-many-optional)"');
    expect(count(svg, 'class="sc-relation sc-relation-disabled"')).toBe(1);
    expect(svg).toMatch(
      /data-relation="hr\.Employees\.FK_Employees_Manager"[^>]* d="M [\d.]+,[\d.]+ C /u,
    );
  });

  it("shows types at full detail, keys only otherwise, and nothing when collapsed", () => {
    const full = renderDiagramSvg({ snapshot, canvas }, { detailLevel: "full", theme: "dark" });
    expect(full.svg).toContain(">nvarchar?<");
    expect(full.svg).toContain(">Name<");
    expect(full.svg).toContain("#22242b");
    const keys = renderDiagramSvg({ snapshot, canvas }, { detailLevel: "keys", theme: "light" });
    expect(keys.svg).not.toContain(">Name<");
    expect(keys.svg).toContain(">CustomerId<");
    expect(keys.svg).not.toContain(">ManagerId<");
    expect(keys.svg).not.toContain("#22242b");
  });

  it("embeds font faces, keeps the background optional and is deterministic", () => {
    const options = { detailLevel: "keys" as const, theme: "light" as const };
    const first = renderDiagramSvg({ snapshot, canvas }, options);
    const second = renderDiagramSvg({ snapshot, canvas }, options);
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain('class="sc-background"');

    const bare = renderDiagramSvg(
      { snapshot, canvas },
      {
        ...options,
        background: false,
        fontFaces: "@font-face{font-family:Inter}",
        description: "Exported",
      },
    );
    expect(bare.svg).not.toContain('class="sc-background"');
    expect(bare.svg).toContain("<style>@font-face{font-family:Inter}");
    expect(bare.svg).toContain("<desc>Exported</desc>");
  });

  it("renders an empty canvas as an empty document", () => {
    const empty = renderDiagramSvg(
      {
        snapshot: { ...snapshot, tables: [], views: [], foreignKeys: [] },
        canvas: { ...canvas, nodes: [] },
      },
      { detailLevel: "keys", theme: "light" },
    );
    expect(empty.entityCount).toBe(0);
    expect(empty.width).toBe(96);
  });
});

describe("fitText", () => {
  const font = { family: "mono" as const, size: 10, weight: 400 as const };

  it("keeps text that fits and truncates with an ellipsis otherwise", () => {
    expect(fitText("Orders", 100, font, estimateTextWidth)).toBe("Orders");
    expect(fitText("CustomerOrderLines", 60, font, estimateTextWidth)).toBe(`CustomerO${ELLIPSIS}`);
    expect(fitText("Orders", 1, font, estimateTextWidth)).toBe(ELLIPSIS);
  });
});
