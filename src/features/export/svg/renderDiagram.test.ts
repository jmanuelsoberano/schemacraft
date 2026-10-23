import { describe, expect, it } from "vitest";

import type { CanvasState, Column, SchemaSnapshot, Trigger } from "@/shared/contracts";
import { triggerBadgeLabel } from "@/features/canvas/triggerBadgeText";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";

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

/** The words drawn into the diagram, as the English application passes them. */
const labels = {
  view: "VIEW",
  triggers: (badge: Parameters<typeof triggerBadgeLabel>[0]) =>
    triggerBadgeLabel(badge, createCatalogTranslator(messageCatalogs.en, "en")),
};

const count = (text: string, needle: string) => text.split(needle).length - 1;

/** The `<g>` of one entity, its header and rows included. */
function entityMarkup(svg: string, key: string): string {
  const start = svg.indexOf(`data-entity="${key}"`);
  const end = svg.indexOf("</g>", start);
  return start === -1 || end === -1 ? "" : svg.slice(svg.lastIndexOf("<g", start), end);
}

describe("renderDiagramSvg", () => {
  it("draws the visible entities and the relationships between them", () => {
    const rendered = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels },
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
    const extent = measureDiagram({ snapshot, canvas }, "keys", { padding: 48 });
    // Nodes span x 100..740 (Orders at 500 + 240) plus the loop of Employees, y 100..438.
    expect(extent.width).toBe(740 - 100 + 44 + 4 + 48 * 2);
    expect(extent.height).toBe(400 + 38 - 100 + 48 * 2);
    const full = measureDiagram({ snapshot, canvas }, "full", { padding: 48 });
    expect(full.height).toBeGreaterThan(extent.height);
    const compact = measureDiagram({ snapshot, canvas }, "compact", { padding: 48 });
    expect(compact.height).toBeLessThan(full.height);
    expect(compact.height).toBeLessThanOrEqual(extent.height);
  });

  it("marks cardinality, disabled relationships and self-references", () => {
    const { svg } = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels },
    );
    // A required key reads "exactly one" at the referenced end; a key column that accepts
    // NULL, here SalesRepId and ManagerId, makes it "zero or one".
    const ends = (name: string) =>
      new RegExp(
        `data-relation="[^"]*\\.${name}"[^>]* marker-start="url\\(#([a-z-]+)\\)" marker-end="url\\(#([a-z-]+)\\)"`,
        "u",
      )
        .exec(svg)
        ?.slice(1);
    expect(ends("FK_Orders_Customers")).toEqual(["sc-many", "sc-one"]);
    expect(ends("FK_Orders_Employees")).toEqual(["sc-many", "sc-zero-or-one"]);
    expect(ends("FK_Employees_Manager")).toEqual(["sc-many", "sc-zero-or-one"]);
    expect(count(svg, 'class="sc-relation sc-relation-disabled"')).toBe(1);
    expect(svg).toMatch(
      /data-relation="hr\.Employees\.FK_Employees_Manager"[^>]* d="M [\d.]+,[\d.]+ C /u,
    );
    // The marker ids and shapes are what the viewer's stylesheet and the canvas rely on.
    expect(svg).toContain(
      '<marker id="sc-many" viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="13" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="sc-marker" d="M1,7 L13,1 M1,7 L13,7 M1,7 L13,13"/></marker>',
    );
    expect(svg).toContain(
      '<marker id="sc-one" viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="13" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="sc-marker" d="M6,1 L6,13 M1,7 L13,7"/></marker>',
    );
    expect(svg).toContain(
      '<marker id="sc-zero-or-one" viewBox="0 0 22 14" markerWidth="22" markerHeight="14" refX="21" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="sc-marker" d="M14,1 L14,13 M1,7 L21,7"/><circle class="sc-marker-fill" cx="6" cy="7" r="3"/></marker>',
    );
    for (const id of ["sc-many", "sc-one", "sc-zero-or-one"]) {
      expect(count(svg, `<marker id="${id}"`)).toBe(1);
      expect(count(svg, `<marker id="${id}-active"`)).toBe(1);
    }
    expect(svg).toContain('<circle class="sc-marker-fill-active" cx="6" cy="7" r="3"/>');
    expect(svg).not.toContain("sc-many-optional");
  });

  it("draws a one-to-one key as zero or one at the referencing end", () => {
    // dbo.Hidden's primary key is its key column: a customer has at most one such row.
    const oneToOne: SchemaSnapshot = {
      ...snapshot,
      tables: snapshot.tables.map((table) =>
        table.name.name === "Hidden"
          ? { ...table, primaryKey: { name: "PK_Hidden", columns: ["Id"], isClustered: true } }
          : table,
      ),
    };
    const shown: CanvasState = {
      ...canvas,
      nodes: canvas.nodes.map((node) => ({ ...node, isHidden: false })),
    };
    const { svg } = renderDiagramSvg(
      { snapshot: oneToOne, canvas: shown },
      { detailLevel: "keys", theme: "light", labels },
    );
    expect(svg).toMatch(
      /data-relation="dbo\.Hidden\.FK_Hidden_Customers"[^>]* marker-start="url\(#sc-zero-or-one\)" marker-end="url\(#sc-one\)"/u,
    );
  });

  it("tells a view apart by its tint, icon and label, as a header-only card at keys", () => {
    const { svg } = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels },
    );
    const view = entityMarkup(svg, "sales.RecentOrders");
    const table = entityMarkup(svg, "dbo.Customers");

    expect(view.startsWith('<g class="sc-entity sc-view"')).toBe(true);
    expect(table.startsWith('<g class="sc-entity"')).toBe(true);
    // The same 38 px box as before: the label changes nothing in the geometry.
    expect(view).toContain('<rect class="sc-node-fill" width="240" height="38" rx="10"/>');
    expect(view).toContain('<rect class="sc-view-header" width="240" height="38" rx="10"/>');
    expect(view).not.toContain("sc-divider");
    expect(view).toContain('<use href="#sc-icon-view" class="sc-icon-view-kind"');
    expect(view).toContain('<tspan class="sc-view-schema">sales.</tspan>');
    // The label sits one gap left of the count pill, with the title ending before it.
    expect(view).toContain(
      '<rect class="sc-kind-label" x="175" y="11" width="33" height="16" rx="4"/>',
    );
    expect(view).toContain('<text class="sc-kind-label-text" x="191.5" y="22.5">VIEW</text>');
    expect(view).toContain('<rect class="sc-count-pill" x="214" y="11" width="18" height="16"');

    // Tables keep their icon, their muted schema prefix and no label.
    expect(table).toContain('<use href="#sc-icon-table" class="sc-icon-kind"');
    expect(table).toContain('<tspan class="sc-title-schema">dbo.</tspan>');
    expect(table).not.toContain("sc-kind-label");
    expect(count(svg, 'class="sc-kind-label"')).toBe(1);
    expect(count(svg, ">VIEW<")).toBe(1);

    // The styles come from the view tokens, in each theme.
    expect(svg).toContain(".sc-view-header{fill:#e3f6f6}");
    expect(svg).toContain(".sc-view-schema{fill:#525561}");
    expect(svg).toContain(".sc-kind-label{fill:#007475}");
    expect(svg).toContain(
      '.sc-kind-label-text{font-family:Inter, "Segoe UI", system-ui, sans-serif;font-size:10px;font-weight:600;fill:#fcfcfc;text-anchor:middle}',
    );
    expect(svg).toContain(".sc-icon-view-kind{stroke:#007475}");
    const dark = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "full", theme: "dark", labels },
    );
    expect(dark.svg).toContain(".sc-view-header{fill:#112e2e}");
    expect(dark.svg).toContain(".sc-view-schema{fill:#a2a4ac}");
    expect(dark.svg).toContain(".sc-kind-label{fill:#50bfbe}");
    expect(dark.svg).toContain("fill:#061414;text-anchor:middle}");
    expect(dark.svg).toContain(".sc-icon-view-kind{stroke:#50bfbe}");
    // At full detail the view shows its columns under the same header.
    const fullView = entityMarkup(dark.svg, "sales.RecentOrders");
    expect(fullView).toContain(">VIEW<");
    expect(fullView).toContain(">OrderId<");
    expect(fullView).toContain("sc-divider");
  });

  it("draws the label in the language it is given and escapes it", () => {
    const spanish = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels: { ...labels, view: "VISTA" } },
    );
    expect(spanish.svg).toContain(">VISTA</text>");
    expect(spanish.svg).not.toContain(">VIEW<");
    // A longer word widens the label and pushes the title's room to the left.
    expect(spanish.svg).toContain('<rect class="sc-kind-label" x="169" y="11" width="39"');

    const odd = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels: { ...labels, view: "<V>" } },
    );
    expect(odd.svg).toContain(">&lt;V&gt;</text>");
    expect(odd.svg).not.toContain("><V><");
  });

  it("truncates a long view name before the label instead of running under it", () => {
    const longName = "RecentOrdersByCustomerAndRegion";
    const input = {
      snapshot: {
        ...snapshot,
        views: [{ name: { schema: "sales", name: longName }, columns: [column("OrderId", "int")] }],
      },
      canvas: {
        ...canvas,
        nodes: canvas.nodes.map((node) =>
          node.name.name === "RecentOrders"
            ? { ...node, name: { schema: "sales", name: longName } }
            : node,
        ),
      },
    };
    const { svg } = renderDiagramSvg(input, { detailLevel: "keys", theme: "light", labels });
    const view = entityMarkup(svg, `sales.${longName}`);
    const shown = /<tspan class="sc-title-name">([^<]*)<\/tspan>/u.exec(view)?.[1] ?? "";
    expect(shown.endsWith(ELLIPSIS)).toBe(true);
    // Title from x 30 to the label at 175 less a gap, minus the "sales." prefix.
    const room =
      175 - 6 - 30 - estimateTextWidth("sales.", { family: "mono", size: 12, weight: 400 });
    expect(estimateTextWidth(shown, { family: "mono", size: 12, weight: 600 })).toBeLessThanOrEqual(
      room,
    );
    expect(view).toContain(">VIEW</text>");
  });

  it("shows types at full detail, keys only otherwise, and nothing when collapsed", () => {
    const full = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "full", theme: "dark", labels },
    );
    expect(full.svg).toContain(">nvarchar?<");
    expect(full.svg).toContain(">Name<");
    expect(full.svg).toContain("#22242b");
    const keys = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels },
    );
    expect(keys.svg).not.toContain(">Name<");
    expect(keys.svg).toContain(">CustomerId<");
    expect(keys.svg).not.toContain(">ManagerId<");
    expect(keys.svg).not.toContain("#22242b");
  });

  it("names each row by its whole column name, escaped, even when the shown name is cut short", () => {
    const long = 'A "quoted" & <very> long column name that cannot fit on one card row';
    const wide: SchemaSnapshot = {
      ...snapshot,
      tables: snapshot.tables.map((table) =>
        table.name.name === "Customers"
          ? { ...table, columns: [...table.columns, column(long, "int")] }
          : table,
      ),
    };
    const { svg } = renderDiagramSvg(
      { snapshot: wide, canvas },
      { detailLevel: "full", theme: "light", labels },
    );
    const customers = entityMarkup(svg, "dbo.Customers");
    expect(customers).toContain('class="sc-column" data-column="CustomerId"');
    expect(customers).toContain('data-column="Email"');
    expect(customers).toContain(
      'data-column="A &quot;quoted&quot; &amp; &lt;very&gt; long column name that cannot fit on one card row"',
    );
    expect(customers).toContain(`${ELLIPSIS}</text>`);
    // One per row drawn, in row order, which is how the viewer finds a row's place.
    expect(count(customers, "data-column=")).toBe(4);
    expect(customers.indexOf('data-column="Name"')).toBeLessThan(
      customers.indexOf('data-column="Email"'),
    );
    const collapsed = entityMarkup(svg, "hr.Employees");
    expect(collapsed).not.toContain("data-column=");
  });

  it("embeds font faces, keeps the background optional and is deterministic", () => {
    const options = { detailLevel: "keys" as const, theme: "light" as const, labels };
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

  it("sets a footnote under the diagram, bottom left, and makes room for it", () => {
    const options = { detailLevel: "keys" as const, theme: "light" as const, labels };
    const plain = renderDiagramSvg({ snapshot, canvas }, options);
    const noted = renderDiagramSvg(
      { snapshot, canvas },
      { ...options, footnote: "Partial capture & <more>" },
    );

    expect(plain.svg).not.toContain("sc-footnote");
    expect(noted.width).toBe(plain.width);
    // The nodes end 338 below the top padding; the line sits 16 below them and is 16 high.
    expect(noted.height).toBe(plain.height + 32);
    expect(noted.svg).toContain(
      '<text class="sc-footnote" x="48" y="413.85">Partial capture &amp; &lt;more&gt;</text>',
    );
    expect(noted.svg).toContain(".sc-footnote{");
    expect(noted.svg.endsWith("</text>\n</svg>")).toBe(true);
  });

  it("widens a narrow diagram to fit its footnote, the same whether measured or drawn", () => {
    const onlyCustomers = {
      snapshot,
      canvas: {
        ...canvas,
        nodes: canvas.nodes.map((node) =>
          node.name.name === "Customers" ? node : { ...node, isHidden: true },
        ),
      },
    };
    const footnote =
      "Partial capture: some tables, views or expressions weren't visible to the login that read the schema.";

    const measured = measureDiagram(onlyCustomers, "keys", { footnote });
    const drawn = renderDiagramSvg(onlyCustomers, {
      detailLevel: "keys",
      theme: "dark",
      labels,
      footnote,
      measureText: (text) => text.length,
    });

    expect(measured.width).toBe(
      Math.ceil(estimateTextWidth(footnote, { family: "sans", size: 11, weight: 400 }) + 96),
    );
    expect(measured.width).toBeGreaterThan(240 + 96);
    expect({ width: drawn.width, height: drawn.height }).toEqual({
      width: measured.width,
      height: measured.height,
    });
    expect(drawn.svg).toContain(".sc-footnote{font-family:");
    expect(drawn.svg).toContain("fill:#a2a4ac}");
  });

  it("renders an empty canvas as an empty document", () => {
    const empty = renderDiagramSvg(
      {
        snapshot: { ...snapshot, tables: [], views: [], foreignKeys: [] },
        canvas: { ...canvas, nodes: [] },
      },
      { detailLevel: "keys", theme: "light", labels },
    );
    expect(empty.entityCount).toBe(0);
    expect(empty.width).toBe(96);
  });
});

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    parent: { schema: "dbo", name: "Customers" },
    name: "trg_PrivateTriggerName",
    timing: "after",
    events: [{ event: "insert", order: "first" }],
    isEnabled: true,
    isNotForReplication: false,
    body: {
      language: "sql",
      definition: { status: "readable", text: "PRIVATE_TRIGGER_BODY_SENTINEL" },
    },
    ...overrides,
  };
}

function triggerSnapshot(triggers: Trigger[]): SchemaSnapshot {
  return {
    ...snapshot,
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      routines: [],
      views: [],
      triggers,
    },
  };
}

describe("trigger badges in exported drawings", () => {
  const options = { detailLevel: "compact" as const, theme: "light" as const, labels };
  const triggerNotes = {
    legend: "Enabled count; dashed means all disabled.",
    notRead: "Triggers were not read for this diagram.",
    notChecked: "Some trigger metadata could not be checked for this diagram.",
  };

  it("draws neutral solid and dashed badges without exporting names or code", () => {
    const input = {
      snapshot: triggerSnapshot([
        trigger(),
        trigger({ name: "Second", timing: "insteadOf" }),
        trigger({ name: "Disabled", isEnabled: false }),
        trigger({
          parent: { schema: "sales", name: "RecentOrders" },
          isEnabled: false,
          timing: "insteadOf",
        }),
      ]),
      canvas,
    };
    const { svg } = renderDiagramSvg(input, options);
    expect(svg).toContain('class="sc-trigger-badge"');
    expect(svg).toContain('class="sc-trigger-badge sc-trigger-disabled"');
    expect(svg).toContain('href="#sc-icon-trigger"');
    expect(svg).toContain('href="#sc-icon-trigger-disabled"');
    expect(svg).toContain(
      "2 triggers are enabled. 1 of the enabled triggers uses INSTEAD OF. 1 trigger is disabled.",
    );
    expect(svg).toContain("1 trigger is disabled. 1 of the disabled triggers uses INSTEAD OF.");
    expect(svg).toContain(".sc-trigger-badge{fill:none;stroke:#c8cad3;stroke-width:1}");
    expect(svg).toContain(".sc-trigger-disabled{stroke-dasharray:3 2}");
    expect(svg).not.toContain("trg_PrivateTriggerName");
    expect(svg).not.toContain("PRIVATE_TRIGGER_BODY_SENTINEL");
    expect(renderDiagramSvg(input, options).svg).toBe(svg);
  });

  it("escapes translated titles and makes room for a badge by shortening the name", () => {
    const capture = triggerSnapshot([trigger()]);
    const name = "CustomerOrdersWithAnUnusuallyLongTitle";
    const first = capture.tables[0];
    const code = capture.programmability;
    if (first === undefined || code === undefined) throw new Error("fixture missing");
    const renamed = {
      ...capture,
      tables: [{ ...first, name: { ...first.name, name } }],
      views: [],
      foreignKeys: [],
      programmability: { ...code, triggers: [trigger({ parent: { ...first.name, name } })] },
    };
    const withBadge = renderDiagramSvg(
      { snapshot: renamed, canvas: { ...canvas, nodes: [] } },
      {
        ...options,
        labels: { ...labels, triggers: () => 'Enabled & <disabled> "label"' },
      },
    );
    const withoutBadge = renderDiagramSvg(
      {
        snapshot: { ...renamed, programmability: { ...renamed.programmability, triggers: [] } },
        canvas: { ...canvas, nodes: [] },
      },
      options,
    );
    expect(withBadge.svg).toContain(
      "<title>Enabled &amp; &lt;disabled&gt; &quot;label&quot;</title>",
    );
    const shownName = (svg: string) =>
      /<tspan class="sc-title-name">([^<]+)<\/tspan>/u.exec(svg)?.[1] ?? "";
    expect(shownName(withBadge.svg).length).toBeLessThan(shownName(withoutBadge.svg).length);
    expect(withBadge.height).toBe(withoutBadge.height);
  });

  it("adds only applicable notes, including older and unverified captures", () => {
    const input = { snapshot: triggerSnapshot([trigger()]), canvas };
    const drawn = renderDiagramSvg(input, {
      ...options,
      triggerNotes,
      footnote: "Partial capture.",
    });
    expect(drawn.svg).toContain(triggerNotes.legend);
    expect(drawn.svg).not.toContain(triggerNotes.notRead);
    expect(drawn.svg).toContain("Partial capture.");
    const measured = measureDiagram(input, "compact", {
      triggerNotes,
      footnote: "Partial capture.",
    });
    expect({ width: drawn.width, height: drawn.height }).toEqual({
      width: measured.width,
      height: measured.height,
    });

    const legacy = renderDiagramSvg({ snapshot, canvas }, { ...options, triggerNotes });
    expect(legacy.svg).toContain(triggerNotes.notRead);
    expect(legacy.svg).not.toContain(triggerNotes.legend);
    const retained = {
      ...input.snapshot,
      carriedOver: [
        {
          object: { schema: "dbo", name: "Customers" },
          fact: { kind: "table" as const },
          readAt: "2026-10-12T00:00:00Z",
        },
      ],
    };
    const unchecked = renderDiagramSvg(
      { snapshot: retained, canvas },
      { ...options, triggerNotes },
    );
    expect(unchecked.svg).toContain(triggerNotes.notChecked);
    expect(unchecked.svg).not.toContain(triggerNotes.notRead);
    expect(unchecked.svg).not.toContain('class="sc-triggers"');
  });

  it("keeps verified badges and the legend when only another parent's trigger list is unverified", () => {
    const capture = triggerSnapshot([
      trigger(),
      trigger({ parent: { schema: "sales", name: "RecentOrders" } }),
    ]);
    const mixed = {
      ...capture,
      carriedOver: [
        {
          object: { schema: "dbo", name: "Customers" },
          fact: { kind: "table" as const },
          readAt: "2026-10-12T00:00:00Z",
        },
      ],
    };
    const rendered = renderDiagramSvg({ snapshot: mixed, canvas }, { ...options, triggerNotes });
    expect(count(rendered.svg, 'class="sc-triggers"')).toBe(1);
    expect(rendered.svg).toContain(triggerNotes.legend);
    expect(rendered.svg).toContain(triggerNotes.notChecked);
    expect(rendered.svg).not.toContain(triggerNotes.notRead);
  });

  it("keeps a read empty capture byte-identical and ignores triggers of hidden objects", () => {
    const baseline = renderDiagramSvg({ snapshot, canvas }, options);
    const empty = renderDiagramSvg(
      { snapshot: triggerSnapshot([]), canvas },
      { ...options, triggerNotes },
    );
    expect(empty.svg).toBe(baseline.svg);
    const hidden = renderDiagramSvg(
      {
        snapshot: triggerSnapshot([trigger({ parent: { schema: "dbo", name: "Hidden" } })]),
        canvas,
      },
      { ...options, triggerNotes },
    );
    expect(hidden.svg).toBe(baseline.svg);
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

describe("reviewed annotation text", () => {
  it("keeps normal words intact and preserves explicit paragraph breaks in the drawn notes", () => {
    const prose = "A reviewed explanation stays readable across exported diagrams. ".repeat(20);
    const noteLines = [`${prose}\r\n\r\nLast explicit paragraph\rEnd`];
    const rendered = renderDiagramSvg(
      { snapshot, canvas },
      { detailLevel: "keys", theme: "light", labels, noteLines },
    );
    const measured = measureDiagram({ snapshot, canvas }, "keys", { noteLines });
    const lines = [
      ...rendered.svg.matchAll(/<text class="sc-footnote"[^>]*>([^<]*)<\/text>/gu),
    ].map((match) => match[1] ?? "");
    expect(lines.slice(0, -3).join("")).toBe(prose);
    for (const line of lines.slice(0, -3)) expect(line).toMatch(/\s$/u);
    expect(lines.slice(-3)).toEqual([" ", "Last explicit paragraph", "End"]);
    expect({ width: rendered.width, height: rendered.height }).toMatchObject({
      width: measured.width,
      height: measured.height,
    });
  });

  it("wraps without clipping and escapes markup using the same measured extent", () => {
    const noteLines = [
      "A reviewed description",
      "</script><svg onload=evil()> & notes",
      "X".repeat(1800),
      "Last line",
    ];
    const options = { detailLevel: "keys" as const, theme: "light" as const, labels, noteLines };
    const rendered = renderDiagramSvg({ snapshot, canvas }, options);
    const measured = measureDiagram({ snapshot, canvas }, "keys", { noteLines });
    const baseline = measureDiagram({ snapshot, canvas }, "keys");
    expect(rendered.width).toBe(measured.width);
    expect(rendered.height).toBe(measured.height);
    expect(rendered.height).toBeGreaterThan(baseline.height);
    expect(rendered.svg).toContain("&lt;/script&gt;&lt;svg onload=evil()&gt; &amp; notes");
    expect(rendered.svg).not.toContain("<svg onload");
    expect(rendered.svg).toContain("Last line");
    expect(rendered.width).toBeLessThan(baseline.width + 700);
    const lastBaseline = [
      ...rendered.svg.matchAll(/class="sc-footnote" x="[^"]+" y="([^"]+)"/gu),
    ].at(-1)?.[1];
    expect(Number(lastBaseline)).toBeLessThan(rendered.height);
  });
});
