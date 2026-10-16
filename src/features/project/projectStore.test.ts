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

const inspection = { schemas: [], includeViews: true };

const emptyPreferences = { formatVersion: 1, recentConnections: [], recentProjects: [] };

function savedFile(): Project {
  return {
    formatVersion: 2,
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
    project: { ...savedFile(), formatVersion: 3, savedWith: "SchemaCraft 1.3.0" },
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
    formatVersion: 2,
    minReaderVersion: 2,
    savedAt: "2026-10-15T20:00:00Z",
    savedWith: "SchemaCraft 1.1.0",
    ...content,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(project?.content.connection.authentication).toEqual({
      mode: "sqlLogin",
      username: "sa",
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
    expect(project?.liveSettings?.trustServerCertificate).toBe(false);
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
          ...{ annotations: [{ entity: customers, text: "Monthly partitions" }] },
          snapshot: { ...file.snapshot, ...{ routines: [{ name: "usp_PlaceOrder" }] } },
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
      annotations: [{ entity: customers, text: "Monthly partitions" }],
      snapshot: { routines: [{ name: "usp_PlaceOrder" }] },
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
