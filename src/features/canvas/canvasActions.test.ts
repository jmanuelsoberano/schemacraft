import { beforeEach, describe, expect, it, vi } from "vitest";

import { entityKey } from "@/features/schema/entities";
import type { ConnectionSettings, SchemaSnapshot } from "@/shared/contracts";

const projectBackend = vi.hoisted(() => ({
  pickProjectToOpen: vi.fn(),
  pickProjectToSave: vi.fn(),
  readProject: vi.fn(),
  writeProject: vi.fn(),
  computeSchemaDiff: vi.fn(),
  refreshProjectContent: vi.fn(),
}));

const preferencesBackend = vi.hoisted(() => ({
  readPreferences: vi.fn(),
  rememberConnection: vi.fn(),
  forgetConnection: vi.fn(),
  rememberProject: vi.fn(),
  forgetProject: vi.fn(),
}));

vi.mock("@/shared/ipc/projectBackend", () => ({
  PROJECT_FILE_EXTENSION: "scraft",
  getProjectBackend: () => Promise.resolve(projectBackend),
}));

vi.mock("@/shared/ipc/preferencesBackend", () => ({
  getPreferencesBackend: () => Promise.resolve(preferencesBackend),
}));

vi.mock("@/shared/settings/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ locale: "en" }) },
}));

// No worker in the node environment; the commands under test must never reach the engine.
vi.mock("./layouts/elkWorker", () => ({
  createElkInWorker: () => {
    throw new Error("the layout engine is not available in tests");
  },
}));

const { useProjectStore } = await import("@/features/project/projectStore");
const { useCanvasUiStore } = await import("./canvasUiStore");
const {
  applyLastLayout,
  isolateEntity,
  setCollapsed,
  setCollapsedForAll,
  setHidden,
  showAllEntities,
} = await import("./canvasActions");

function table(schema: string, name: string): SchemaSnapshot["tables"][number] {
  return {
    name: { schema, name },
    columns: [],
    primaryKey: null,
    indexes: [],
    checkConstraints: [],
  };
}

function relation(
  name: string,
  referencing: [string, string],
  referenced: [string, string],
): SchemaSnapshot["foreignKeys"][number] {
  return {
    name,
    referencingTable: { schema: referencing[0], name: referencing[1] },
    referencedTable: { schema: referenced[0], name: referenced[1] },
    columnPairs: [],
    onDelete: "noAction",
    onUpdate: "noAction",
    isEnabled: true,
  };
}

/** Customers <- Orders <- OrderLines, with Employees and a view on their own. */
const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    table("dbo", "Customers"),
    table("sales", "Orders"),
    table("sales", "OrderLines"),
    table("hr", "Employees"),
  ],
  views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [] }],
  foreignKeys: [
    relation("FK_Orders_Customers", ["sales", "Orders"], ["dbo", "Customers"]),
    relation("FK_OrderLines_Orders", ["sales", "OrderLines"], ["sales", "Orders"]),
  ],
};

const EVERY_KEY = [
  "dbo.Customers",
  "sales.Orders",
  "sales.OrderLines",
  "hr.Employees",
  "sales.RecentOrders",
];

const settings: ConnectionSettings = {
  provider: "sqlServer",
  host: "localhost",
  instance: null,
  port: 1433,
  database: "Shop",
  authentication: { mode: "integrated" },
  encryption: "mandatory",
  trustServerCertificate: false,
  connectTimeoutSeconds: 15,
};

function nodes() {
  return useProjectStore.getState().project?.content.canvas.nodes ?? [];
}

function hiddenKeys(): string[] {
  return nodes()
    .filter((node) => node.isHidden)
    .map((node) => entityKey(node.name));
}

function visibleKeys(): string[] {
  return nodes()
    .filter((node) => !node.isHidden)
    .map((node) => entityKey(node.name));
}

function collapsedKeys(): string[] {
  return nodes()
    .filter((node) => node.isCollapsed)
    .map((node) => entityKey(node.name));
}

function undoSteps(): number {
  return useProjectStore.getState().history.past.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({
    project: null,
    phase: "idle",
    failure: null,
    pendingDiscard: null,
    history: { past: [], future: [] },
  });
  useCanvasUiStore.setState({ fitRequest: 0, isLayoutRunning: false });
});

describe("with a project open", () => {
  beforeEach(() => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot, settings, { schemas: [], includeViews: true });
  });

  it("hides and shows only the given entities, one undo step per change", () => {
    setHidden(["sales.Orders", "hr.Employees"], true);
    expect(hiddenKeys()).toEqual(["sales.Orders", "hr.Employees"]);
    expect(undoSteps()).toBe(1);
    expect(useProjectStore.getState().project?.isDirty).toBe(true);

    setHidden(["sales.Orders"], false);
    expect(hiddenKeys()).toEqual(["hr.Employees"]);
    expect(undoSteps()).toBe(2);

    // Asking for what already holds changes nothing and records nothing.
    setHidden(["dbo.Customers"], false);
    expect(undoSteps()).toBe(2);

    useProjectStore.getState().undo();
    expect(hiddenKeys()).toEqual(["sales.Orders", "hr.Employees"]);
    useProjectStore.getState().undo();
    expect(hiddenKeys()).toEqual([]);
  });

  it("collapses and expands only the given entities, undoably", () => {
    setCollapsed(["dbo.Customers"], true);
    expect(collapsedKeys()).toEqual(["dbo.Customers"]);
    expect(undoSteps()).toBe(1);

    setCollapsed(["dbo.Customers"], false);
    expect(collapsedKeys()).toEqual([]);
    expect(undoSteps()).toBe(2);

    useProjectStore.getState().undo();
    expect(collapsedKeys()).toEqual(["dbo.Customers"]);
    expect(hiddenKeys()).toEqual([]);
  });

  it("collapses and expands every entity at once", () => {
    setCollapsedForAll(true);
    expect(collapsedKeys()).toEqual(EVERY_KEY);
    expect(undoSteps()).toBe(1);

    setCollapsedForAll(false);
    expect(collapsedKeys()).toEqual([]);
    expect(undoSteps()).toBe(2);

    setCollapsedForAll(false);
    expect(undoSteps()).toBe(2);
  });

  it("shows every hidden entity again and asks the canvas to fit", () => {
    setHidden(["sales.Orders", "sales.RecentOrders"], true);
    const fitRequests = useCanvasUiStore.getState().fitRequest;

    showAllEntities();

    expect(hiddenKeys()).toEqual([]);
    expect(visibleKeys()).toEqual(EVERY_KEY);
    expect(useCanvasUiStore.getState().fitRequest).toBe(fitRequests + 1);
    expect(undoSteps()).toBe(2);

    useProjectStore.getState().undo();
    expect(hiddenKeys()).toEqual(["sales.Orders", "sales.RecentOrders"]);
  });

  it("isolates an entity with its neighbours one or two hops away", () => {
    isolateEntity("sales.OrderLines", 1);
    expect(visibleKeys()).toEqual(["sales.Orders", "sales.OrderLines"]);
    expect(useCanvasUiStore.getState().fitRequest).toBe(1);
    expect(undoSteps()).toBe(1);

    isolateEntity("sales.OrderLines", 2);
    expect(visibleKeys()).toEqual(["dbo.Customers", "sales.Orders", "sales.OrderLines"]);
    expect(useCanvasUiStore.getState().fitRequest).toBe(2);

    // Orders reaches both its parent and its child in one hop; the rest stays hidden.
    isolateEntity("sales.Orders", 1);
    expect(visibleKeys()).toEqual(["dbo.Customers", "sales.Orders", "sales.OrderLines"]);
    expect(hiddenKeys()).toEqual(["hr.Employees", "sales.RecentOrders"]);

    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    expect(visibleKeys()).toEqual(["sales.Orders", "sales.OrderLines"]);
  });
});

describe("without a project", () => {
  it("does nothing, records nothing and never reaches the layout engine", async () => {
    setHidden(["dbo.Customers"], true);
    setCollapsed(["dbo.Customers"], true);
    setCollapsedForAll(true);
    showAllEntities();
    isolateEntity("dbo.Customers", 2);
    await applyLastLayout();

    expect(useProjectStore.getState().project).toBeNull();
    expect(undoSteps()).toBe(0);
    expect(useCanvasUiStore.getState().fitRequest).toBe(0);
    expect(useCanvasUiStore.getState().isLayoutRunning).toBe(false);
  });
});
