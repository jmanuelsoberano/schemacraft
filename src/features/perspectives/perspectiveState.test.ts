import { describe, expect, it } from "vitest";

import type { ProjectContent } from "@/shared/contracts";

import {
  activeCanvas,
  ensurePerspectivePlaced,
  noteTargetKey,
  projectExportAnnotations,
  reconcileAnnotations,
} from "./perspectiveState";

function content(): ProjectContent {
  const table = { schema: "a.b", name: "c" };
  const other = { schema: "a", name: "b.c" };
  const canvas = {
    detailLevel: "keys" as const,
    layout: "manual" as const,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { name: table, position: { x: 12, y: 20 }, isCollapsed: false, isHidden: false },
      { name: other, position: { x: 412, y: 20 }, isCollapsed: false, isHidden: true },
    ],
  };
  return {
    connection: {
      provider: "sqlServer",
      host: "not-exported",
      instance: null,
      port: 1433,
      database: "Demo",
      authentication: { mode: "integrated" },
      encryption: "mandatory",
      trustServerCertificate: false,
    },
    inspection: {
      schemas: [],
      includeViews: true,
      includeProgrammability: true,
      includeModuleDefinitions: true,
    },
    snapshot: {
      databaseName: "Demo",
      serverVersion: null,
      extractedAt: "2026-10-23T00:00:00Z",
      tables: [table, other].map((name) => ({
        name,
        columns: [],
        primaryKey: null,
        indexes: [],
        checkConstraints: [],
      })),
      views: [],
      foreignKeys: [],
    },
    canvas,
    perspectives: [
      { id: "sales", name: "Sales", description: "REVIEWED_DESCRIPTION", canvas },
      {
        id: "private",
        name: "OTHER_MAP_SENTINEL",
        description: "OTHER_DESCRIPTION_SENTINEL",
        canvas,
      },
    ],
    activePerspectiveId: "sales",
    annotations: {
      notes: [
        {
          id: "approved",
          target: { kind: "table", table },
          text: "</script><img onerror=evil()> REVIEWED_TEXT",
          isLinked: true,
          ...{ secretExtension: "EXTENSION_SENTINEL" },
        },
        {
          id: "not-approved",
          target: { kind: "table", table },
          text: "UNCHECKED_SENTINEL",
          isLinked: true,
        },
        {
          id: "hidden",
          target: { kind: "table", table: other },
          text: "HIDDEN_NOTE_SENTINEL",
          isLinked: true,
        },
        {
          id: "archived",
          target: { kind: "table", table },
          text: "ARCHIVED_SENTINEL",
          isLinked: false,
        },
      ],
    },
  };
}

describe("saved perspective values", () => {
  it("keeps curated membership when newly captured entities are placed", () => {
    const project = content();
    const original = project.canvas.nodes[0];
    if (original === undefined) throw new Error("fixture node expected");
    const placed = ensurePerspectivePlaced(
      { ...project.canvas, nodes: [original] },
      project.snapshot,
    );
    expect(placed.nodes[0]).toBe(original);
    expect(placed.nodes[1]?.isHidden).toBe(true);
    expect(placed.nodes[0]?.position).toEqual({ x: 12, y: 20 });
  });

  it("falls back to General for an unknown active identity", () => {
    const project = content();
    expect(activeCanvas({ ...project, activePerspectiveId: "missing" })).toBe(project.canvas);
  });

  it("never confuses punctuation boundaries or relinks an archived target", () => {
    expect(noteTargetKey({ kind: "table", table: { schema: "a.b", name: "c" } })).not.toBe(
      noteTargetKey({ kind: "table", table: { schema: "a", name: "b.c" } }),
    );
    const project = content();
    const removed = {
      ...project.snapshot,
      tables: [],
      views: project.snapshot.tables.map((table) => ({ name: table.name, columns: [] })),
    };
    const archived = reconcileAnnotations(project.annotations, removed);
    expect(archived?.notes.every((note) => !note.isLinked)).toBe(true);
    expect(
      reconcileAnnotations(archived, project.snapshot)?.notes.every((note) => !note.isLinked),
    ).toBe(true);
  });

  it("projects only reviewed, linked, visible text without IDs or unknown extensions", () => {
    const project = content();
    expect(projectExportAnnotations(project, project.canvas, false, new Set())).toEqual({
      description: null,
      notes: [],
    });
    const projected = projectExportAnnotations(
      project,
      project.canvas,
      true,
      new Set(["approved", "hidden", "archived"]),
    );
    const bytes = JSON.stringify(projected);
    expect(projected.description).toBe("REVIEWED_DESCRIPTION");
    expect(projected.notes).toHaveLength(1);
    expect(projected.notes[0]?.text).toContain("</script><img onerror=evil()>");
    for (const secret of [
      "UNCHECKED_SENTINEL",
      "HIDDEN_NOTE_SENTINEL",
      "ARCHIVED_SENTINEL",
      "OTHER_MAP_SENTINEL",
      "OTHER_DESCRIPTION_SENTINEL",
      "EXTENSION_SENTINEL",
      "not-exported",
      '"id"',
    ])
      expect(bytes).not.toContain(secret);
  });
});
