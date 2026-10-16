import { describe, expect, it } from "vitest";

import type { AccessProfile, CanvasState, SchemaSnapshot } from "@/shared/contracts";

import { buildStandalonePage, embedJson } from "./buildStandalonePage";
import { carriesAccessNote, exportedAccess, visibleProjection } from "./viewerData";

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: "Microsoft SQL Server 2022",
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "A" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "dbo", name: "B" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "dbo", name: "V" }, columns: [] }],
  foreignKeys: [
    {
      name: "FK_A_B",
      referencingTable: { schema: "dbo", name: "A" },
      referencedTable: { schema: "dbo", name: "B" },
      columnPairs: [],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
};

const canvas: CanvasState = {
  detailLevel: "keys",
  layout: "manual",
  viewport: { x: 10, y: 20, zoom: 0.5 },
  nodes: [
    {
      name: { schema: "dbo", name: "A" },
      position: { x: 0, y: 0 },
      isCollapsed: false,
      isHidden: false,
    },
    {
      name: { schema: "dbo", name: "B" },
      position: { x: 0, y: 0 },
      isCollapsed: false,
      isHidden: true,
    },
    {
      name: { schema: "dbo", name: "V" },
      position: { x: 0, y: 0 },
      isCollapsed: false,
      isHidden: false,
    },
  ],
};

/** Read by a login that sees part of the database, in a file a newer version wrote. */
const partialAccess: AccessProfile = {
  probe: {
    canReadDefinitions: false,
    canReadData: true,
    explicitDenials: 1,
    seesObjects: true,
    schemas: [
      {
        name: "audit",
        canReadDefinitions: false,
        canReadData: false,
        isDenied: true,
        hasVisibleObjects: false,
      },
      {
        name: "dbo",
        canReadDefinitions: false,
        canReadData: true,
        isDenied: false,
        hasVisibleObjects: true,
      },
    ],
    databaseUser: "reporting_user",
  },
  scope: { schemas: ["dbo", "payroll"], includeViews: true },
  level: "partial",
  coverage: { objects: "partial", definitions: "notAvailable" },
  counts: { definitions: 0, definitionsNotVisible: 0, foreignKeysToInvisibleTables: 2 },
};

const partialSnapshot: SchemaSnapshot = {
  ...snapshot,
  access: partialAccess,
  foreignKeysToInvisibleTables: [
    {
      name: "FK_A_Regions",
      referencingTable: { schema: "dbo", name: "A" },
      columns: ["RegionId"],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
    {
      name: "FK_B_Regions",
      referencingTable: { schema: "dbo", name: "B" },
      columns: ["RegionId"],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
  carriedOver: [
    {
      object: { schema: "audit", name: "ChangeLog" },
      fact: { kind: "table" },
      readAt: "2026-10-12T08:00:00Z",
    },
  ],
  ...{ routines: [{ name: { schema: "internal", name: "usp_Purge" } }] },
};

const decoratedCanvas: CanvasState = {
  ...canvas,
  ...{ gridSize: 16 },
  nodes: canvas.nodes.map((node) => ({ ...node, ...{ color: "teal" } })),
};

/** Names and keys that must never reach an exported file. */
const NEVER_EXPORTED = [
  '"probe"',
  '"scope"',
  '"counts"',
  '"databaseUser"',
  "reporting_user",
  '"carriedOver"',
  '"audit"',
  '"payroll"',
  '"internal"',
  '"routines"',
  '"gridSize"',
  '"color"',
  "FK_B_Regions",
  "Microsoft SQL Server",
];

describe("visibleProjection", () => {
  it("keeps only visible objects and drops the server version and the viewport", () => {
    const projected = visibleProjection(snapshot, canvas);
    expect(projected.snapshot.tables.map((table) => table.name.name)).toEqual(["A"]);
    expect(projected.snapshot.views.map((view) => view.name.name)).toEqual(["V"]);
    expect(projected.snapshot.foreignKeys).toEqual([]);
    expect(projected.snapshot.serverVersion).toBeNull();
    expect(projected.canvas.nodes.map((node) => node.name.name)).toEqual(["A", "V"]);
    expect(projected.canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(projected.access).toBeNull();
    expect(projected.snapshot).not.toHaveProperty("foreignKeysToInvisibleTables");
  });

  it("carries the access verdict, never the probe, the kept facts or unknown keys", () => {
    const projected = visibleProjection(partialSnapshot, decoratedCanvas);

    expect(projected.access).toEqual({ level: "partial" });
    expect(Object.keys(projected.snapshot).sort()).toEqual([
      "databaseName",
      "extractedAt",
      "foreignKeys",
      "foreignKeysToInvisibleTables",
      "serverVersion",
      "tables",
      "views",
    ]);
    // The key of a hidden table stays behind; the one of a visible table keeps its badge.
    expect(projected.snapshot.foreignKeysToInvisibleTables?.map((key) => key.name)).toEqual([
      "FK_A_Regions",
    ]);
    expect(Object.keys(projected.canvas).sort()).toEqual([
      "detailLevel",
      "layout",
      "nodes",
      "viewport",
    ]);
    for (const node of projected.canvas.nodes) {
      expect(Object.keys(node).sort()).toEqual(["isCollapsed", "isHidden", "name", "position"]);
    }
    const embedded = embedJson(projected);
    for (const secret of NEVER_EXPORTED) {
      expect(embedded, secret).not.toContain(secret);
    }
  });

  it("exports a table kept from an earlier read like any other, without the list naming it", () => {
    // A refresh with a weaker login kept audit.ChangeLog in the snapshot and on the canvas.
    const changeLog = {
      name: { schema: "audit", name: "ChangeLog" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    };
    const kept: SchemaSnapshot = {
      ...partialSnapshot,
      tables: [...partialSnapshot.tables, changeLog],
    };
    const placed: CanvasState = {
      ...canvas,
      nodes: [
        ...canvas.nodes,
        { name: changeLog.name, position: { x: 0, y: 0 }, isCollapsed: false, isHidden: false },
      ],
    };

    const projected = visibleProjection(kept, placed);

    expect(projected.snapshot.tables.map((table) => table.name.name)).toEqual(["A", "ChangeLog"]);
    expect(projected.canvas.nodes.map((node) => node.name.name)).toEqual(["A", "V", "ChangeLog"]);
    expect(projected.snapshot).not.toHaveProperty("carriedOver");
    expect(embedJson(projected)).not.toContain('"carriedOver"');
  });
});

describe("the access note", () => {
  it("is carried by exports of a partial capture only", () => {
    expect(exportedAccess(partialSnapshot)).toEqual({ level: "partial" });
    expect(exportedAccess(snapshot)).toBeNull();
    expect(carriesAccessNote({ level: "partial" })).toBe(true);
    expect(carriesAccessNote({ level: "full" })).toBe(false);
    expect(carriesAccessNote({ level: "empty" })).toBe(false);
    expect(carriesAccessNote(null)).toBe(false);
  });
});

describe("buildStandalonePage", () => {
  it("embeds the data, the viewer and the styles without external references", () => {
    const page = buildStandalonePage({
      data: {
        generator: "SchemaCraft 0.1.0",
        exportedAt: "2026-10-13T20:00:00Z",
        locale: "es",
        theme: "dark",
        detailLevel: "full",
        ...visibleProjection({ ...snapshot, databaseName: "Shop </script>" }, canvas),
      },
      viewerScript: 'console.log("</script>")',
      viewerStyles: "body{margin:0}",
      fontFaces: "@font-face{font-family:Inter}",
    });
    expect(page.startsWith('<!doctype html>\n<html lang="es" data-theme="dark">')).toBe(true);
    expect(page).toContain("<title>Shop &lt;/script&gt; · SchemaCraft</title>");
    // Fonts first, then the diagram palette for both themes, then the viewer's own rules.
    const style = /<style>(.*?)<\/style>/su.exec(page)?.[1] ?? "";
    expect(style.startsWith("@font-face{font-family:Inter}:root{--sc-canvas:#f6f7f9;")).toBe(true);
    expect(style).toContain("--sc-view:#007475;");
    expect(style).toContain(':root[data-theme="dark"]{--sc-canvas:#101117;');
    expect(style.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(style.indexOf(":root{"));
    expect(style.endsWith("--sc-on-view:#061414;}body{margin:0}")).toBe(true);
    expect(page).toContain('<script id="schemacraft-data" type="application/json">');
    expect(page).toContain('<script>console.log("<\\/script>")</script>');
    expect(page).not.toContain('</script>")');
    expect(page).not.toMatch(/src="http/u);
  });

  it("leaves out of the page what the projection keeps in the application", () => {
    const page = buildStandalonePage({
      data: {
        generator: "SchemaCraft 1.1.0",
        exportedAt: "2026-10-15T20:00:00Z",
        locale: "en",
        theme: "light",
        detailLevel: "keys",
        ...visibleProjection(partialSnapshot, decoratedCanvas),
      },
      viewerScript: "",
      viewerStyles: "",
      fontFaces: "",
    });
    expect(page).toContain('"access":{"level":"partial"}');
    expect(page).toContain("FK_A_Regions");
    for (const secret of NEVER_EXPORTED) {
      expect(page, secret).not.toContain(secret);
    }
  });

  it("escapes what would close the data script", () => {
    expect(embedJson({ name: "</script><b>" })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
    expect(embedJson("line\u2028break")).toBe('"line\\u2028break"');
  });
});
