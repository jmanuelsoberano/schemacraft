import { describe, expect, it } from "vitest";

import type { CanvasState, SchemaSnapshot } from "@/shared/contracts";

import { buildStandalonePage, embedJson } from "./buildStandalonePage";
import { visibleProjection } from "./viewerData";

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

describe("visibleProjection", () => {
  it("keeps only visible objects and drops the server version and the viewport", () => {
    const projected = visibleProjection(snapshot, canvas);
    expect(projected.snapshot.tables.map((table) => table.name.name)).toEqual(["A"]);
    expect(projected.snapshot.views.map((view) => view.name.name)).toEqual(["V"]);
    expect(projected.snapshot.foreignKeys).toEqual([]);
    expect(projected.snapshot.serverVersion).toBeNull();
    expect(projected.canvas.nodes.map((node) => node.name.name)).toEqual(["A", "V"]);
    expect(projected.canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
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
    expect(page).toContain("<style>@font-face{font-family:Inter}body{margin:0}</style>");
    expect(page).toContain('<script id="schemacraft-data" type="application/json">');
    expect(page).toContain('<script>console.log("<\\/script>")</script>');
    expect(page).not.toContain('</script>")');
    expect(page).not.toMatch(/src="http/u);
  });

  it("escapes what would close the data script", () => {
    expect(embedJson({ name: "</script><b>" })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
    expect(embedJson("line\u2028break")).toBe('"line\\u2028break"');
  });
});
