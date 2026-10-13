import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConnectionSettings,
  Project,
  ProjectContent,
  SchemaSnapshot,
} from "@/shared/contracts";
import { OperationError } from "@/shared/ipc/operationError";

const projectBackend = vi.hoisted(() => ({
  pickProjectToOpen: vi.fn<(title: string) => Promise<string | null>>(),
  pickProjectToSave: vi.fn<(title: string, suggested: string) => Promise<string | null>>(),
  readProject: vi.fn<(path: string) => Promise<Project>>(),
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
    formatVersion: 1,
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

beforeEach(() => {
  vi.clearAllMocks();
  preferencesBackend.rememberProject.mockResolvedValue(emptyPreferences);
  preferencesBackend.forgetProject.mockResolvedValue(emptyPreferences);
  useProjectStore.setState({ project: null, phase: "idle", failure: null, pendingDiscard: null });
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
      "Save project as",
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
    projectBackend.readProject.mockResolvedValue(savedFile());

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
    projectBackend.readProject.mockResolvedValue(savedFile());

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
