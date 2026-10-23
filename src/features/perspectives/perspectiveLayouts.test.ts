import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionSettings, Point, SchemaSnapshot } from "@/shared/contracts";

const layout = vi.hoisted(() => ({
  run: vi.fn<() => Promise<Map<string, Point>>>(),
}));

vi.mock("@/features/canvas/layouts", () => ({
  buildLayoutInput: () => ({}),
  runLayout: layout.run,
  placeNearRelated: () => new Map(),
}));
vi.mock("@/features/canvas/layouts/elkWorker", () => ({ createElkInWorker: () => ({}) }));
vi.mock("@/shared/settings/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ locale: "en" }) },
}));

const { useProjectStore } = await import("@/features/project/projectStore");
const { useCanvasUiStore } = await import("@/features/canvas/canvasUiStore");
const { applyLayout } = await import("@/features/canvas/canvasActions");
const { withPositions } = await import("@/features/canvas/canvasState");
const { activeCanvas } = await import("./perspectiveState");

const settings: ConnectionSettings = {
  provider: "sqlServer",
  host: "localhost",
  instance: null,
  port: 1433,
  database: "Demo",
  authentication: { mode: "integrated" },
  encryption: "mandatory",
  trustServerCertificate: false,
  connectTimeoutSeconds: 15,
};
const snapshot: SchemaSnapshot = {
  databaseName: "Demo",
  serverVersion: null,
  extractedAt: "2026-10-23T00:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Orders" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [],
  foreignKeys: [],
};

beforeEach(() => {
  layout.run.mockReset();
  useCanvasUiStore.getState().setLayoutRunning(false);
  useProjectStore.setState({ project: null, history: { past: [], future: [] } });
  useProjectStore.getState().loadFromInspection(snapshot, settings, {
    schemas: [],
    includeViews: true,
    includeProgrammability: true,
    includeModuleDefinitions: true,
  });
});

function pendingLayout() {
  let finish: (value: Map<string, Point>) => void = () => undefined;
  layout.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const running = applyLayout({ kind: "layered", direction: "down" });
  return {
    running,
    complete: () => {
      finish(new Map([["dbo.Orders", { x: 900, y: 900 }]]));
    },
  };
}

describe("layout result ownership", () => {
  it("discards a late layout after switching perspective", async () => {
    const store = useProjectStore.getState();
    store.createPerspective("Sales");
    const pending = pendingLayout();
    store.selectPerspective(null);
    const before = useProjectStore.getState().project?.content.canvas;
    pending.complete();
    await pending.running;
    expect(useProjectStore.getState().project?.content.canvas).toBe(before);
    expect(useCanvasUiStore.getState().isLayoutRunning).toBe(false);
  });

  it("discards a late layout after a manual edit in the same perspective", async () => {
    const store = useProjectStore.getState();
    store.createPerspective("Sales");
    const pending = pendingLayout();
    store.updateCanvas((canvas) =>
      withPositions(canvas, new Map([["dbo.Orders", { x: 77, y: 88 }]])),
    );
    pending.complete();
    await pending.running;
    const content = useProjectStore.getState().project?.content;
    if (content === undefined) throw new Error("project expected");
    expect(activeCanvas(content).nodes[0]?.position).toEqual({ x: 77, y: 88 });
  });

  it("discards a late layout after a refreshed snapshot", async () => {
    const store = useProjectStore.getState();
    const pending = pendingLayout();
    const content = useProjectStore.getState().project?.content;
    if (content === undefined) throw new Error("project expected");
    store.applyRefreshedContent(
      { ...content, snapshot: { ...snapshot, extractedAt: "2026-10-23T01:00:00Z" } },
      settings,
    );
    const before = useProjectStore.getState().project?.content.canvas;
    pending.complete();
    await pending.running;
    expect(useProjectStore.getState().project?.content.canvas).toBe(before);
  });
});
