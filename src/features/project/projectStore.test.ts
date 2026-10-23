import type { FileDialogLabels } from "@/shared/ipc/projectBackend";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConnectionSettings,
  OpenedProject,
  Project,
  ProjectContent,
  SchemaSnapshot,
} from "@/shared/contracts";
import {
  withCollapsed,
  withHidden,
  withLayout,
  withPositions,
} from "@/features/canvas/canvasState";
import { OperationError } from "@/shared/ipc/operationError";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { activeCanvas, linkedNote } from "@/features/perspectives/perspectiveState";

const projectBackend = vi.hoisted(() => ({
  pickProjectToOpen: vi.fn<(labels: FileDialogLabels) => Promise<string | null>>(),
  pickProjectToSave:
    vi.fn<(labels: FileDialogLabels, suggested: string) => Promise<string | null>>(),
  readProject: vi.fn<(path: string) => Promise<OpenedProject>>(),
  writeProject: vi.fn<(path: string, content: ProjectContent) => Promise<Project>>(),
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

const { useProjectStore } = await import("./projectStore");

const snapshot: SchemaSnapshot = {
  databaseName: "Northwind",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Customers" },
      columns: [],
      primaryKey: null,
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [],
  foreignKeys: [],
};

const settings: ConnectionSettings = {
  provider: "sqlServer",
  host: "localhost",
  instance: null,
  port: 14333,
  database: "Northwind",
  authentication: {
    mode: "sqlLogin",
    username: "sa",
    password: { source: "provided", value: "secret" },
  },
  encryption: "mandatory",
  trustServerCertificate: true,
  connectTimeoutSeconds: 15,
};

const inspection = {
  schemas: [],
  includeViews: true,
  includeProgrammability: true,
  includeModuleDefinitions: true,
};

const emptyPreferences = { formatVersion: 1, recentConnections: [], recentProjects: [] };

function savedFile(): Project {
  return {
    formatVersion: 3,
    minReaderVersion: 2,
    savedAt: "2026-10-13T18:30:00Z",
    savedWith: "SchemaCraft 0.1.0",
    connection: {
      provider: "sqlServer",
      host: "localhost",
      instance: null,
      port: 14333,
      database: "Northwind",
      authentication: { mode: "sqlLogin", username: "sa" },
      encryption: "mandatory",
      trustServerCertificate: true,
    },
    inspection,
    snapshot,
    canvas: { detailLevel: "full", layout: "manual", viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
  };
}

function openedFile(): OpenedProject {
  return { project: savedFile(), isReadOnly: false };
}

/** A file a newer version wrote, which this one opens read-only. */
function newerFile(): OpenedProject {
  return {
    project: { ...savedFile(), formatVersion: 4, savedWith: "SchemaCraft 1.3.0" },
    isReadOnly: true,
  };
}

async function open(opened: OpenedProject, path: string): Promise<void> {
  projectBackend.readProject.mockResolvedValue(opened);
  useProjectStore.getState().openProject(path);
  await vi.waitFor(() => {
    expect(useProjectStore.getState().project?.path).toBe(path);
  });
}

/** What the Rust side answers to a save: the content under a fresh header. */
function writtenAs(content: ProjectContent): Promise<Project> {
  return Promise.resolve({
    formatVersion: 3,
    minReaderVersion: 2,
    savedAt: "2026-10-15T20:00:00Z",
    savedWith: "SchemaCraft 1.1.0",
    ...content,
  });
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error("deferred promise is not initialized");
  };
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCanvasUiStore.getState().clearSelection();
  preferencesBackend.rememberProject.mockResolvedValue(emptyPreferences);
  preferencesBackend.forgetProject.mockResolvedValue(emptyPreferences);
  useProjectStore.setState({
    project: null,
    phase: "idle",
    failure: null,
    pendingDiscard: null,
    history: { past: [], future: [] },
  });
});

describe("loadFromInspection", () => {
  it("starts an unsaved project that keeps the password only in memory", () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);

    const { project } = useProjectStore.getState();
    expect(project?.path).toBeNull();
    expect(project?.isDirty).toBe(false);
    expect(project?.liveSettings).toBe(settings);
    expect(project?.content.connection).toMatchObject({
      authentication: { mode: "sqlLogin", username: "sa" },
    });
    expect(JSON.stringify(project?.content)).not.toContain("secret");
    expect(project?.content.canvas.detailLevel).toBe("keys");
  });

  it("keeps the detail level chosen for the previous project", () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    useProjectStore.getState().setDetailLevel("full");
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    expect(useProjectStore.getState().project?.content.canvas.detailLevel).toBe("full");
  });
});

describe("saving", () => {
  it.each([false, true])(
    "preserves a new viewport during save without inventing dirty changes (initially dirty: %s)",
    async (initiallyDirty) => {
      await open(openedFile(), "C:\\work\\a.scraft");
      const store = useProjectStore.getState();
      if (initiallyDirty) store.setDetailLevel("compact");
      expect(useProjectStore.getState().project?.isDirty).toBe(initiallyDirty);
      const write = deferred<Project>();
      projectBackend.writeProject.mockReturnValue(write.promise);
      const saving = store.saveProject();
      await vi.waitFor(() => {
        expect(projectBackend.writeProject).toHaveBeenCalledOnce();
      });
      const written = projectBackend.writeProject.mock.calls[0]?.[1];
      if (written === undefined) throw new Error("written project expected");
      const revision = useProjectStore.getState().project?.editRevision ?? 0;
      const viewport = { x: 125, y: -36, zoom: 0.75 };
      store.updateCanvas((canvas) => ({ ...canvas, viewport }), { dirty: false, undoable: false });
      expect(useProjectStore.getState().project?.editRevision).toBe(revision + 1);
      write.resolve(await writtenAs(written));
      await saving;
      expect(useProjectStore.getState().project?.isDirty).toBe(false);
      expect(useProjectStore.getState().project?.content.canvas.viewport).toEqual(viewport);
      expect(useProjectStore.getState().project?.content.canvas.detailLevel).toBe(
        initiallyDirty ? "compact" : "full",
      );
    },
  );

  it("preserves a non-dirty map switch while an ordinary save finishes", async () => {
    const file = savedFile();
    await open(
      {
        project: {
          ...file,
          perspectives: [{ id: "sales", name: "Sales", description: null, canvas: file.canvas }],
          activePerspectiveId: "sales",
        },
        isReadOnly: false,
      },
      "C:\\work\\maps.scraft",
    );
    const write = deferred<Project>();
    projectBackend.writeProject.mockReturnValue(write.promise);
    const store = useProjectStore.getState();
    const saving = store.saveProject();
    await vi.waitFor(() => {
      expect(projectBackend.writeProject).toHaveBeenCalledOnce();
    });
    const written = projectBackend.writeProject.mock.calls[0]?.[1];
    if (written === undefined) throw new Error("written project expected");
    store.selectPerspective(null);
    write.resolve(await writtenAs(written));
    await saving;
    expect(useProjectStore.getState().project?.isDirty).toBe(false);
    expect(useProjectStore.getState().project?.content.activePerspectiveId).toBeUndefined();
    expect(useProjectStore.getState().project?.content.perspectives?.[0]?.id).toBe("sales");
  });

  it("keeps a real note edit unsaved when it occurs during an older write", async () => {
    await open(openedFile(), "C:\\work\\a.scraft");
    const write = deferred<Project>();
    projectBackend.writeProject.mockReturnValue(write.promise);
    const store = useProjectStore.getState();
    const saving = store.saveProject();
    await vi.waitFor(() => {
      expect(projectBackend.writeProject).toHaveBeenCalledOnce();
    });
    const written = projectBackend.writeProject.mock.calls[0]?.[1];
    if (written === undefined) throw new Error("written project expected");
    const target = { kind: "table" as const, table: { schema: "dbo", name: "Customers" } };
    store.setObjectNote(target, "New explanation");
    write.resolve(await writtenAs(written));
    await saving;
    const project = useProjectStore.getState().project;
    expect(project?.isDirty).toBe(true);
    if (project === null) throw new Error("project expected");
    expect(linkedNote(project.content, target)?.text).toBe("New explanation");
  });

  it("does not apply an old Save-as picker to a newly loaded document", async () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    const picker = deferred<string | null>();
    projectBackend.pickProjectToSave.mockReturnValue(picker.promise);
    const saving = useProjectStore.getState().saveProjectAs();
    await vi.waitFor(() => {
      expect(projectBackend.pickProjectToSave).toHaveBeenCalledOnce();
    });
    useProjectStore
      .getState()
      .loadFromInspection({ ...snapshot, databaseName: "Another" }, settings, inspection);
    picker.resolve("C:\\work\\old-document.scraft");
    await saving;
    expect(projectBackend.writeProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project?.content.snapshot.databaseName).toBe("Another");
    expect(useProjectStore.getState().project?.path).toBeNull();
  });

  it("asks for a path the first time and records the saved file", async () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    useProjectStore.getState().setDetailLevel("compact");
    projectBackend.pickProjectToSave.mockResolvedValue("C:\\work\\northwind.scraft");
    projectBackend.writeProject.mockResolvedValue(savedFile());

    await useProjectStore.getState().saveProject();

    expect(projectBackend.pickProjectToSave).toHaveBeenCalledWith(
      { title: "Save project as", fileTypeName: "SchemaCraft project" },
      "Northwind.scraft",
    );
    const { project } = useProjectStore.getState();
    expect(project?.path).toBe("C:\\work\\northwind.scraft");
    expect(project?.savedAt).toBe("2026-10-13T18:30:00Z");
    expect(project?.isDirty).toBe(false);
    expect(preferencesBackend.rememberProject).toHaveBeenCalledWith("C:\\work\\northwind.scraft");
  });

  it("saves to the known path without asking again", async () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, path: "C:\\work\\a.scraft" },
    }));
    projectBackend.writeProject.mockResolvedValue(savedFile());

    await useProjectStore.getState().saveProject();

    expect(projectBackend.pickProjectToSave).not.toHaveBeenCalled();
    expect(projectBackend.writeProject).toHaveBeenCalledWith(
      "C:\\work\\a.scraft",
      expect.objectContaining({ snapshot }),
    );
  });

  it("does nothing when the picker is cancelled and reports write failures", async () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    projectBackend.pickProjectToSave.mockResolvedValue(null);
    await useProjectStore.getState().saveProject();
    expect(projectBackend.writeProject).not.toHaveBeenCalled();

    projectBackend.pickProjectToSave.mockResolvedValue("D:\\readonly\\x.scraft");
    projectBackend.writeProject.mockRejectedValue(
      new OperationError({ type: "project", value: "write" }, "access denied"),
    );
    await useProjectStore.getState().saveProject();

    const { failure, project } = useProjectStore.getState();
    expect(failure?.operation).toBe("save");
    expect(failure?.error.kind).toEqual({ type: "project", value: "write" });
    expect(project?.path).toBeNull();
  });
});

describe("opening", () => {
  it("reads the chosen file into a clean project without live settings", async () => {
    projectBackend.pickProjectToOpen.mockResolvedValue("C:\\work\\northwind.scraft");
    projectBackend.readProject.mockResolvedValue(openedFile());

    useProjectStore.getState().openProject();
    await vi.waitFor(() => {
      expect(useProjectStore.getState().project).not.toBeNull();
    });

    const { project } = useProjectStore.getState();
    expect(project?.path).toBe("C:\\work\\northwind.scraft");
    expect(project?.liveSettings).toBeNull();
    expect(project?.isDirty).toBe(false);
    expect(project?.content.canvas.detailLevel).toBe("full");
    expect(preferencesBackend.rememberProject).toHaveBeenCalledWith("C:\\work\\northwind.scraft");
  });

  it("forgets a recent project whose file disappeared", async () => {
    projectBackend.readProject.mockRejectedValue(
      new OperationError({ type: "project", value: "notFound" }, "gone"),
    );

    useProjectStore.getState().openProject("C:\\work\\gone.scraft");
    await vi.waitFor(() => {
      expect(useProjectStore.getState().failure).not.toBeNull();
    });

    expect(useProjectStore.getState().failure?.operation).toBe("open");
    expect(preferencesBackend.forgetProject).toHaveBeenCalledWith("C:\\work\\gone.scraft");
    expect(useProjectStore.getState().project).toBeNull();
  });

  it("asks before discarding unsaved changes", async () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    useProjectStore.getState().setDetailLevel("compact");
    projectBackend.readProject.mockResolvedValue(openedFile());

    useProjectStore.getState().openProject("C:\\work\\other.scraft");
    expect(useProjectStore.getState().pendingDiscard).not.toBeNull();
    expect(projectBackend.readProject).not.toHaveBeenCalled();

    useProjectStore.getState().cancelDiscard();
    expect(useProjectStore.getState().pendingDiscard).toBeNull();
    expect(useProjectStore.getState().project?.isDirty).toBe(true);

    useProjectStore.getState().openProject("C:\\work\\other.scraft");
    useProjectStore.getState().confirmDiscard();
    await vi.waitFor(() => {
      expect(useProjectStore.getState().project?.path).toBe("C:\\work\\other.scraft");
    });
  });
});

describe("changes", () => {
  it("keeps a selected routine on refresh only while it still exists, and clears it on a new document", async () => {
    const name = { schema: "sales", name: "usp_ReadOrders" };
    const module = { kind: "routine" as const, name };
    const withCode: SchemaSnapshot = {
      ...snapshot,
      programmability: {
        capture: { objects: { status: "read" }, definitions: { status: "read" } },
        views: [],
        triggers: [],
        routines: [
          {
            name,
            kind: "procedure",
            body: { language: "sql", definition: { status: "readable", text: "SELECT 1;" } },
            parameters: [],
            returns: null,
            columns: [],
          },
        ],
      },
    };
    useProjectStore.getState().loadFromInspection(withCode, settings, inspection);
    useCanvasUiStore.getState().selectModule(module);
    const content = useProjectStore.getState().project?.content;
    if (content === undefined) throw new Error("project expected");
    useProjectStore.getState().applyRefreshedContent(content, settings);
    expect(useCanvasUiStore.getState().selectedModule).toEqual(module);
    useProjectStore.getState().applyRefreshedContent({ ...content, snapshot }, settings);
    expect(useCanvasUiStore.getState().selectedModule).toBeNull();
    useCanvasUiStore.getState().selectModule(module);
    useProjectStore.getState().loadFromInspection(withCode, settings, inspection);
    expect(useCanvasUiStore.getState().selectedModule).toBeNull();
    useCanvasUiStore.getState().selectModule(module);
    await open(openedFile(), "C:\\work\\other.scraft");
    expect(useCanvasUiStore.getState().selectedModule).toBeNull();
  });

  it("marks the project dirty when the detail level or the content change", () => {
    useProjectStore.getState().loadFromInspection(snapshot, settings, inspection);
    useProjectStore.getState().setDetailLevel("keys");
    expect(useProjectStore.getState().project?.isDirty).toBe(false);

    useProjectStore.getState().setDetailLevel("compact");
    expect(useProjectStore.getState().project?.isDirty).toBe(true);

    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, isDirty: false },
    }));
    const content = useProjectStore.getState().project?.content;
    if (content === undefined) {
      throw new Error("project expected");
    }
    useProjectStore
      .getState()
      .applyRefreshedContent(
        { ...content, snapshot: { ...snapshot, tables: [] } },
        { ...settings, trustServerCertificate: false },
      );
    const { project } = useProjectStore.getState();
    expect(project?.isDirty).toBe(true);
    expect(project?.content.snapshot.tables).toEqual([]);
    expect(project?.liveSettings).toMatchObject({ trustServerCertificate: false });
  });
});

describe("a read-only project", () => {
  const key = "dbo.Customers";

  it("can be rearranged but is never marked unsaved", async () => {
    await open(newerFile(), "C:\\work\\next.scraft");
    const opened = useProjectStore.getState().project;
    expect(opened?.isReadOnly).toBe(true);
    expect(opened?.savedWith).toBe("SchemaCraft 1.3.0");

    useProjectStore
      .getState()
      .updateCanvas((canvas) => withPositions(canvas, new Map([[key, { x: 300, y: 40 }]])));
    useProjectStore.getState().updateCanvas((canvas) => withCollapsed(canvas, [key], true));
    useProjectStore.getState().setDetailLevel("compact");
    expect(useProjectStore.getState().project?.content.canvas.nodes[0]?.position).toEqual({
      x: 300,
      y: 40,
    });
    expect(useProjectStore.getState().project?.isDirty).toBe(false);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project?.content.canvas.nodes[0]?.isCollapsed).toBe(false);
    expect(useProjectStore.getState().project?.isDirty).toBe(false);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project?.content.canvas.nodes[0]?.isCollapsed).toBe(true);
    expect(useProjectStore.getState().project?.isDirty).toBe(false);

    const content = useProjectStore.getState().project?.content;
    if (content === undefined) {
      throw new Error("project expected");
    }
    useProjectStore.getState().applyRefreshedContent(content, settings);
    expect(useProjectStore.getState().project?.isDirty).toBe(false);
  });

  it("is never written, and leaving it asks nothing", async () => {
    await open(newerFile(), "C:\\work\\next.scraft");
    useProjectStore.getState().updateCanvas((canvas) => withHidden(canvas, [key], true));

    await useProjectStore.getState().saveProject();
    await useProjectStore.getState().saveProjectAs();
    expect(projectBackend.pickProjectToSave).not.toHaveBeenCalled();
    expect(projectBackend.writeProject).not.toHaveBeenCalled();

    projectBackend.readProject.mockResolvedValue(openedFile());
    useProjectStore.getState().openProject("C:\\work\\other.scraft");
    expect(useProjectStore.getState().pendingDiscard).toBeNull();
    await vi.waitFor(() => {
      expect(useProjectStore.getState().project?.isReadOnly).toBe(false);
    });
  });
});

describe("keys this version does not know", () => {
  it("survive dragging, hiding, collapsing, layouts, undo and saving", async () => {
    const file = savedFile();
    const customers = { schema: "dbo", name: "Customers" };
    await open(
      {
        project: {
          ...file,
          ...{ futureAnnotations: [{ entity: customers, text: "Monthly partitions" }] },
          snapshot: {
            ...file.snapshot,
            ...{ routines: [{ name: "usp_PlaceOrder" }] },
            // The fifth level that keeps keys a newer version wrote.
            programmability: {
              capture: { objects: { status: "read" }, definitions: { status: "read" } },
              views: [],
              routines: [],
              triggers: [],
              ...{ synonyms: [{ name: { schema: "dbo", name: "Clients" } }] },
            },
          },
          canvas: {
            ...file.canvas,
            ...{ gridSize: 16 },
            nodes: [
              {
                name: customers,
                position: { x: 0, y: 0 },
                isCollapsed: false,
                isHidden: false,
                ...{ color: "teal" },
              },
            ],
          },
        },
        isReadOnly: false,
      },
      "C:\\work\\extras.scraft",
    );
    const key = "dbo.Customers";
    const { updateCanvas } = useProjectStore.getState();
    updateCanvas((canvas) => withPositions(canvas, new Map([[key, { x: 120, y: 80 }]])));
    updateCanvas((canvas) => withHidden(canvas, [key], true));
    updateCanvas((canvas) => withHidden(canvas, [key], false));
    updateCanvas((canvas) => withCollapsed(canvas, [key], true));
    updateCanvas((canvas) => withLayout(canvas, new Map([[key, { x: 10, y: 20 }]]), "layered"));
    useProjectStore.getState().setDetailLevel("compact");
    useProjectStore.getState().undo();
    useProjectStore.getState().redo();
    projectBackend.writeProject.mockImplementation((_path, content) => writtenAs(content));

    await useProjectStore.getState().saveProject();

    const written = projectBackend.writeProject.mock.calls[0]?.[1];
    const expected = {
      futureAnnotations: [{ entity: customers, text: "Monthly partitions" }],
      snapshot: {
        routines: [{ name: "usp_PlaceOrder" }],
        programmability: { synonyms: [{ name: { schema: "dbo", name: "Clients" } }] },
      },
      canvas: {
        gridSize: 16,
        layout: "layered",
        nodes: [{ position: { x: 10, y: 20 }, isCollapsed: true, isHidden: false, color: "teal" }],
      },
    };
    expect(written).toMatchObject(expected);
    for (const header of ["formatVersion", "minReaderVersion", "savedAt", "savedWith"]) {
      expect(written).not.toHaveProperty(header);
    }
    // The saved document keeps them too, for the next save.
    expect(useProjectStore.getState().project?.content).toMatchObject(expected);
    expect(useProjectStore.getState().project?.content).not.toHaveProperty("savedWith");
  });
});

describe("independent maps and shared explanations", () => {
  it("edits only the selected map and switching alone leaves a saved project clean", () => {
    const store = useProjectStore.getState();
    store.loadFromInspection(snapshot, settings, inspection);
    const sales = store.createPerspective("Sales");
    expect(sales).not.toBeNull();
    store.updateCanvas((canvas) => withHidden(canvas, ["dbo.Customers"], true));
    store.selectPerspective(null);
    const inventory = store.createPerspective("Inventory");
    const project = useProjectStore.getState().project;
    expect(project?.content.canvas.nodes[0]?.isHidden).toBe(false);
    expect(
      project?.content.perspectives?.find((item) => item.id === sales)?.canvas.nodes[0]?.isHidden,
    ).toBe(true);
    expect(
      project?.content.perspectives?.find((item) => item.id === inventory)?.canvas.nodes[0]
        ?.isHidden,
    ).toBe(false);
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, isDirty: false },
    }));
    const history = useProjectStore.getState().history;
    store.selectPerspective(sales);
    expect(useProjectStore.getState().project?.isDirty).toBe(false);
    expect(useProjectStore.getState().history).toBe(history);
  });

  it("coalesces live note typing, shares the note, and undoes deletion of an entire map", () => {
    const store = useProjectStore.getState();
    store.loadFromInspection(snapshot, settings, inspection);
    const id = store.createPerspective("Sales");
    const target = { kind: "table" as const, table: { schema: "dbo", name: "Customers" } };
    const before = useProjectStore.getState().history.past.length;
    store.setObjectNote(target, "A");
    store.setObjectNote(target, "A shared explanation");
    store.finishNoteEdit();
    expect(useProjectStore.getState().history.past).toHaveLength(before + 1);
    store.selectPerspective(null);
    const content = useProjectStore.getState().project?.content;
    if (content === undefined || id === null) throw new Error("project expected");
    expect(linkedNote(content, target)?.text).toBe("A shared explanation");
    store.deletePerspective(id);
    expect(useProjectStore.getState().project?.content.perspectives).toHaveLength(0);
    store.undo();
    expect(useProjectStore.getState().project?.content.perspectives?.[0]?.id).toBe(id);
    store.undo();
    expect(useProjectStore.getState().project?.content.annotations?.notes ?? []).toHaveLength(0);
  });

  it("refreshes every map, archives removed notes, and prevents undo into another snapshot", () => {
    const store = useProjectStore.getState();
    store.loadFromInspection(snapshot, settings, inspection);
    store.createPerspective("Sales");
    store.selectPerspective(null);
    store.createPerspective("Inventory");
    const target = { kind: "table" as const, table: { schema: "dbo", name: "Customers" } };
    store.setObjectNote(target, "Keep this explanation");
    const content = useProjectStore.getState().project?.content;
    if (content === undefined) throw new Error("project expected");
    const sourceTable = snapshot.tables[0];
    if (sourceTable === undefined) throw new Error("fixture table expected");
    const fresh = {
      ...snapshot,
      tables: [{ ...sourceTable, name: { schema: "dbo", name: "NewTable" } }],
    };
    store.applyRefreshedContent({ ...content, snapshot: fresh }, settings);
    const refreshed = useProjectStore.getState().project;
    expect(refreshed?.content.canvas.nodes[0]?.isHidden).toBe(false);
    expect(
      refreshed?.content.perspectives?.every((item) => item.canvas.nodes[0]?.isHidden === true),
    ).toBe(true);
    expect(refreshed?.content.annotations?.notes[0]).toMatchObject({
      text: "Keep this explanation",
      isLinked: false,
    });
    expect(useProjectStore.getState().history.past).toHaveLength(0);
    store.undo();
    expect(useProjectStore.getState().project).toBe(refreshed);
    if (refreshed === null) throw new Error("project expected");
    expect(activeCanvas(refreshed.content).nodes[0]?.isHidden).toBe(true);
  });
});
