import { beforeEach, describe, expect, it, vi } from "vitest";

import { personas } from "@/features/access/testFixtures";
import type {
  AccessProfile,
  ConnectionSettings,
  DatabaseDescription,
  InspectionEvent,
  InspectionOptions,
  OpenedProject,
  Project,
  ProjectContent,
  SchemaDiff,
  SchemaSnapshot,
  ServerInformation,
} from "@/shared/contracts";

// The draft is persisted to local storage, which the test environment lacks; an in-memory
// stand-in shows what would be written.
const storage = vi.hoisted(() => {
  const items = new Map<string, string>();
  const stub = {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
  // The persist middleware reads `window.localStorage`.
  vi.stubGlobal("window", { localStorage: stub });
  return stub;
});

const connectionBackend = vi.hoisted(() => ({
  testConnection: vi.fn<(settings: ConnectionSettings) => Promise<ServerInformation>>(),
  listDatabases: vi.fn<(settings: ConnectionSettings) => Promise<string[]>>(),
  describeDatabase: vi.fn<(settings: ConnectionSettings) => Promise<DatabaseDescription>>(),
  inspectDatabase:
    vi.fn<
      (
        settings: ConnectionSettings,
        options: InspectionOptions,
        onEvent: (event: InspectionEvent) => void,
      ) => Promise<SchemaSnapshot>
    >(),
  cancelInspection: vi.fn<(jobId: string) => Promise<void>>(),
}));

const credentialsBackend = vi.hoisted(() => ({
  hasStoredPassword: vi.fn(() => Promise.resolve(false)),
  rememberPassword: vi.fn(() => Promise.resolve()),
  forgetPassword: vi.fn(() => Promise.resolve(true)),
}));

const projectBackend = vi.hoisted(() => ({
  pickProjectToOpen: vi.fn(),
  pickProjectToSave: vi.fn(),
  readProject: vi.fn<(path: string) => Promise<OpenedProject>>(),
  writeProject: vi.fn<(path: string, content: ProjectContent) => Promise<Project>>(),
  computeSchemaDiff:
    vi.fn<(previous: SchemaSnapshot, current: SchemaSnapshot) => Promise<SchemaDiff>>(),
  refreshProjectContent:
    vi.fn<(content: ProjectContent, snapshot: SchemaSnapshot) => Promise<ProjectContent>>(),
}));

const preferencesBackend = vi.hoisted(() => ({
  readPreferences: vi.fn(),
  rememberConnection: vi.fn(),
  forgetConnection: vi.fn(),
  rememberProject: vi.fn(),
  forgetProject: vi.fn(),
}));

vi.mock("@/shared/ipc/connectionBackend", () => ({
  getConnectionBackend: () => Promise.resolve(connectionBackend),
}));

vi.mock("@/shared/ipc/credentialsBackend", () => ({
  getCredentialsBackend: () => Promise.resolve(credentialsBackend),
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

const { canReadSchema, mergePersistedConnection, useConnectionStore } =
  await import("./connectionStore");
const { useProjectStore } = await import("@/features/project/projectStore");
const { emptyConnectionDraft } = await import("./connectionDraft");

const server: ServerInformation = {
  product: "Microsoft SQL Server 2022",
  productVersion: "16.0",
  edition: "Developer Edition",
  serverName: "db",
  databaseName: "master",
};

function snapshot(access: AccessProfile, extractedAt = "2026-10-15T09:00:00Z"): SchemaSnapshot {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt,
    access,
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
}

const noChanges = { added: 0, removed: 0, changed: 0 };

function diff(partial: Partial<SchemaDiff> = {}): SchemaDiff {
  return {
    tables: [],
    views: [],
    foreignKeys: [],
    foreignKeysToInvisibleTables: [],
    summary: { tables: noChanges, views: noChanges, foreignKeys: noChanges, code: noChanges },
    code: { changes: [], notChecked: [], nowAvailable: [], readFailures: [] },
    notChecked: [],
    nowAvailable: [],
    accessChanged: false,
    captureChanges: [],
    hasObjectChanges: false,
    isUpToDate: true,
    ...partial,
  };
}

const emptyPreferences = { formatVersion: 1, recentConnections: [], recentProjects: [] };

/** Fills the form for a SQL login and tests the connection to a server with one database. */
async function testedAgainstShop(access: AccessProfile): Promise<void> {
  connectionBackend.testConnection.mockResolvedValue(server);
  connectionBackend.listDatabases.mockResolvedValue(["Shop"]);
  connectionBackend.describeDatabase.mockResolvedValue({
    schemas: ["dbo", "sales"],
    programmabilityOnlySchemas: [],
    access,
  });
  useConnectionStore.getState().updateDraft({
    server: "db",
    authenticationMode: "sqlLogin",
    username: "reporting",
    password: "secret",
  });
  await useConnectionStore.getState().testConnection();
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.items.clear();
  preferencesBackend.rememberConnection.mockResolvedValue(emptyPreferences);
  preferencesBackend.rememberProject.mockResolvedValue(emptyPreferences);
  credentialsBackend.hasStoredPassword.mockResolvedValue(false);
  useConnectionStore.setState({
    draft: emptyConnectionDraft,
    isDialogOpen: true,
    mode: "connect",
    phase: "idle",
    tested: null,
    inspection: null,
    review: null,
    failure: null,
    validation: null,
    blockedInspection: null,
  });
  useProjectStore.setState({
    project: null,
    phase: "idle",
    failure: null,
    pendingDiscard: null,
    history: { past: [], future: [] },
  });
});

describe("selecting a database", () => {
  it("keeps the running read's options when the form changes", async () => {
    await testedAgainstShop(personas.owner);
    useConnectionStore
      .getState()
      .updateDraft({ includeModuleDefinitions: false, schemas: ["dbo"] });
    let finish: (value: SchemaSnapshot) => void = () => undefined;
    connectionBackend.inspectDatabase.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const running = useConnectionStore.getState().inspect();
    await vi.waitFor(() => {
      expect(connectionBackend.inspectDatabase).toHaveBeenCalledOnce();
    });
    useConnectionStore.getState().updateDraft({
      includeProgrammability: false,
      includeModuleDefinitions: true,
      schemas: ["sales"],
    });
    expect(useConnectionStore.getState().inspection?.options).toEqual({
      schemas: ["dbo"],
      includeViews: true,
      includeProgrammability: true,
      includeModuleDefinitions: false,
    });
    finish(snapshot(personas.owner));
    await running;
  });
  it("preserves the chosen schemas when testing the same database during refresh", async () => {
    await testedAgainstShop(personas.owner);
    useConnectionStore.setState({ mode: "refresh" });
    useConnectionStore.getState().updateDraft({ schemas: ["sales"] });
    await useConnectionStore.getState().testConnection();
    expect(useConnectionStore.getState().draft.schemas).toEqual(["sales"]);
    connectionBackend.inspectDatabase.mockResolvedValue(snapshot(personas.owner));
    await useConnectionStore.getState().inspect();
    expect(connectionBackend.inspectDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ schemas: ["sales"] }),
      expect.any(Function),
    );
  });

  it("clears the schema filter when a different database is selected", async () => {
    await testedAgainstShop(personas.owner);
    useConnectionStore.getState().updateDraft({ schemas: ["sales"] });
    connectionBackend.describeDatabase.mockResolvedValue({
      schemas: ["dbo"],
      programmabilityOnlySchemas: ["code_only"],
      access: personas.owner,
    });
    await useConnectionStore.getState().selectDatabase("Other");
    expect(useConnectionStore.getState().draft.schemas).toEqual([]);
    expect(useConnectionStore.getState().tested?.programmabilityOnlySchemas).toEqual(["code_only"]);
  });
  it("keeps the schemas and the predicted access of the database", async () => {
    await testedAgainstShop(personas.reader);

    const { tested, draft, phase } = useConnectionStore.getState();
    expect(phase).toBe("idle");
    expect(draft.database).toBe("Shop");
    expect(tested?.schemas).toEqual(["dbo", "sales"]);
    expect(tested?.access).toEqual(personas.reader);
    expect(connectionBackend.describeDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ host: "db", database: "Shop" }),
    );
  });

  it("forgets the previous prediction while another database is described", async () => {
    await testedAgainstShop(personas.reader);
    let resolve: (description: DatabaseDescription) => void = () => undefined;
    connectionBackend.describeDatabase.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const selecting = useConnectionStore.getState().selectDatabase("Other");
    expect(useConnectionStore.getState().tested?.access).toBeNull();
    resolve({ schemas: ["dbo"], programmabilityOnlySchemas: [], access: personas.owner });
    await selecting;

    expect(useConnectionStore.getState().tested?.access).toEqual(personas.owner);
  });
});

describe("a login that sees nothing", () => {
  it("cannot read the schema once the prediction says so", async () => {
    await testedAgainstShop(personas.connectOnly);
    expect(canReadSchema(useConnectionStore.getState())).toBe(false);
  });

  it("stops a read before it creates a project, and lets the user try another login", async () => {
    await testedAgainstShop(personas.owner);
    expect(canReadSchema(useConnectionStore.getState())).toBe(true);
    connectionBackend.inspectDatabase.mockResolvedValue(snapshot(personas.connectOnly));

    await useConnectionStore.getState().inspect();

    const state = useConnectionStore.getState();
    expect(state.blockedInspection).toEqual({ database: "Shop", access: personas.connectOnly });
    expect(state.phase).toBe("idle");
    expect(state.isDialogOpen).toBe(true);
    expect(useProjectStore.getState().project).toBeNull();
    expect(preferencesBackend.rememberConnection).not.toHaveBeenCalled();
    expect(canReadSchema(state)).toBe(false);

    useConnectionStore.getState().updateDraft({ username: "owner" });
    expect(useConnectionStore.getState().blockedInspection).toBeNull();
  });

  it("stays blocked while only the scope or the password choice changes", async () => {
    await testedAgainstShop(personas.owner);
    connectionBackend.inspectDatabase.mockResolvedValue(snapshot(personas.connectOnly));
    await useConnectionStore.getState().inspect();

    const patches = [{ includeViews: false }, { schemas: ["dbo"] }, { rememberPassword: true }];
    for (const patch of patches) {
      useConnectionStore.getState().updateDraft(patch);
      const state = useConnectionStore.getState();
      expect(state.blockedInspection?.access, JSON.stringify(patch)).toEqual(personas.connectOnly);
      expect(canReadSchema(state), JSON.stringify(patch)).toBe(false);
    }

    useConnectionStore.getState().updateDraft({ password: "another" });
    expect(useConnectionStore.getState().blockedInspection).toBeNull();
  });

  it("stays blocked after refreshing a project opened from a file", async () => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot(personas.owner), liveSettings(), everything());
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, liveSettings: null },
    }));
    credentialsBackend.hasStoredPassword.mockResolvedValue(true);
    connectionBackend.inspectDatabase.mockResolvedValue(snapshot(personas.connectOnly));

    await useConnectionStore.getState().refresh();
    expect(connectionBackend.inspectDatabase).toHaveBeenCalledOnce();
    expect(useConnectionStore.getState().tested).toBeNull();
    expect(useConnectionStore.getState().blockedInspection).not.toBeNull();

    useConnectionStore.getState().updateDraft({ includeViews: false });
    expect(useConnectionStore.getState().blockedInspection).not.toBeNull();
    expect(canReadSchema(useConnectionStore.getState())).toBe(false);
  });

  it("is not reviewed when refreshing either", async () => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot(personas.owner), liveSettings(), everything());
    connectionBackend.inspectDatabase.mockResolvedValue(snapshot(personas.connectOnly));

    await useConnectionStore.getState().refresh();

    expect(projectBackend.computeSchemaDiff).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().review).toBeNull();
    expect(useConnectionStore.getState().blockedInspection?.access.level).toBe("nothingVisible");
  });
});

describe("a login with partial access", () => {
  it("loads the project with what it can see", async () => {
    await testedAgainstShop(personas.reader);
    const partial = snapshot(personas.reader);
    connectionBackend.inspectDatabase.mockResolvedValue(partial);

    await useConnectionStore.getState().inspect();

    expect(useProjectStore.getState().project?.content.snapshot).toBe(partial);
    expect(useConnectionStore.getState().isDialogOpen).toBe(false);
    expect(useConnectionStore.getState().blockedInspection).toBeNull();
    expect(preferencesBackend.rememberConnection).toHaveBeenCalledOnce();
  });

  it("gets a review to apply when a refresh changes nothing it can see", async () => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot(personas.owner), liveSettings(), everything());
    const weaker = snapshot(personas.reader, "2026-10-16T09:00:00Z");
    connectionBackend.inspectDatabase.mockResolvedValue(weaker);
    const notChecked = diff({
      notChecked: [
        {
          object: { schema: "dbo", name: "Customers" },
          fact: { kind: "checkConstraint", name: "CK_Customers_Name" },
          readAt: "2026-10-15T09:00:00Z",
        },
      ],
      accessChanged: true,
      isUpToDate: false,
    });
    projectBackend.computeSchemaDiff.mockResolvedValue(notChecked);

    await useConnectionStore.getState().refresh();

    const { phase, review } = useConnectionStore.getState();
    expect(phase).toBe("reviewing");
    expect(review?.diff).toBe(notChecked);

    const project = useProjectStore.getState().project;
    if (project === null) {
      throw new Error("the project should still be open");
    }
    const refreshed: ProjectContent = { ...project.content, snapshot: weaker };
    projectBackend.refreshProjectContent.mockResolvedValue(refreshed);
    await useConnectionStore.getState().applyReview();

    expect(projectBackend.refreshProjectContent).toHaveBeenCalledWith(project.content, weaker);
    expect(useProjectStore.getState().project?.content.snapshot).toBe(weaker);
    expect(useConnectionStore.getState().phase).toBe("idle");
  });
});

describe("the applied refresh source", () => {
  it.each([
    { includeProgrammability: false, includeModuleDefinitions: false },
    { includeProgrammability: true, includeModuleDefinitions: false },
  ])("saves options %j and the chosen database/login for the next refresh", async (codeOptions) => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot(personas.owner), liveSettings(), everything());
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, liveSettings: null },
    }));
    await useConnectionStore.getState().refresh();
    connectionBackend.testConnection.mockResolvedValue(server);
    connectionBackend.listDatabases.mockResolvedValue(["Shop", "Archive"]);
    connectionBackend.describeDatabase.mockResolvedValue({
      schemas: ["dbo"],
      access: personas.owner,
      programmabilityOnlySchemas: [],
    });
    useConnectionStore.getState().updateDraft({
      database: "Archive",
      username: "archive_reader",
      password: "another-secret",
      schemas: ["dbo"],
      includeViews: false,
      ...codeOptions,
    });
    await useConnectionStore.getState().testConnection();
    const refreshed = { ...snapshot(personas.owner), databaseName: "Archive" };
    connectionBackend.inspectDatabase.mockResolvedValue(refreshed);
    projectBackend.computeSchemaDiff.mockResolvedValue(diff({ isUpToDate: false }));
    projectBackend.refreshProjectContent.mockImplementation((content, current) =>
      Promise.resolve({ ...content, snapshot: current }),
    );
    await useConnectionStore.getState().inspect();
    await useConnectionStore.getState().applyReview();
    const options = { schemas: ["dbo"], includeViews: false, ...codeOptions };
    const content = useProjectStore.getState().project?.content;
    expect(content?.inspection).toEqual(options);
    expect(content?.connection).toMatchObject({
      database: "Archive",
      authentication: { mode: "sqlLogin", username: "archive_reader" },
    });
    expect(JSON.stringify(content)).not.toContain("another-secret");

    let saved: Project | undefined;
    projectBackend.writeProject.mockImplementation((_path, current) => {
      saved = {
        ...current,
        formatVersion: 3,
        minReaderVersion: 2,
        savedAt: "2026-10-19T10:00:00Z",
        savedWith: "SchemaCraft 1.2.0",
      };
      return Promise.resolve(saved);
    });
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, path: "refresh.scraft" },
    }));
    await useProjectStore.getState().saveProject();
    if (saved === undefined) throw new Error("The refreshed project should have been saved");
    projectBackend.readProject.mockResolvedValue({ project: saved, isReadOnly: false });
    useProjectStore.getState().openProject("refresh.scraft");
    await vi.waitFor(() => {
      expect(useProjectStore.getState().phase).toBe("idle");
    });
    expect(useProjectStore.getState().failure).toBeNull();
    await useConnectionStore.getState().refresh();
    expect(useConnectionStore.getState().draft).toMatchObject({
      database: "Archive",
      username: "archive_reader",
      ...options,
    });
    useConnectionStore.getState().updateDraft({ password: "another-secret" });
    await useConnectionStore.getState().testConnection();
    await useConnectionStore.getState().inspect();
    const lastCall = connectionBackend.inspectDatabase.mock.lastCall;
    expect(lastCall?.[0]).toMatchObject({
      database: "Archive",
      authentication: { username: "archive_reader" },
    });
    expect(lastCall?.[1]).toEqual(options);
  });
});

describe("a read-only project", () => {
  it("is never refreshed", async () => {
    useProjectStore
      .getState()
      .loadFromInspection(snapshot(personas.owner), liveSettings(), everything());
    useProjectStore.setState((state) => ({
      project: state.project === null ? null : { ...state.project, isReadOnly: true },
    }));
    useConnectionStore.setState({ isDialogOpen: false });

    await useConnectionStore.getState().refresh();

    expect(connectionBackend.inspectDatabase).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().isDialogOpen).toBe(false);
    expect(useConnectionStore.getState().mode).toBe("connect");
  });
});

describe("the persisted draft", () => {
  it("keeps the defaults of the fields a draft stored by an older version lacks", () => {
    const current = { draft: emptyConnectionDraft, phase: "idle" };
    // A draft that SchemaCraft 1.1 stored, without the code options.
    const stored = {
      draft: { ...emptyConnectionDraft, server: "db", schemas: ["sales"] } as Record<
        string,
        unknown
      >,
    };
    delete stored.draft.includeProgrammability;
    delete stored.draft.includeModuleDefinitions;

    const merged = mergePersistedConnection(stored, current);

    expect(merged.phase).toBe("idle");
    expect(merged.draft).toEqual({
      ...emptyConnectionDraft,
      server: "db",
      schemas: ["sales"],
      includeProgrammability: true,
      includeModuleDefinitions: true,
    });
    expect(mergePersistedConnection(null, current)).toBe(current);
    expect(mergePersistedConnection({ draft: "nope" }, current)).toBe(current);
  });

  it("never holds the password", async () => {
    await testedAgainstShop(personas.owner);

    const written = storage.items.get("schemacraft.connection") ?? "";
    expect(written).toContain('"username":"reporting"');
    expect(written).not.toContain("secret");
    expect(useConnectionStore.getState().draft.password).toBe("secret");
  });
});

function liveSettings(): ConnectionSettings {
  return {
    provider: "sqlServer",
    host: "db",
    instance: null,
    port: null,
    database: "Shop",
    authentication: {
      mode: "sqlLogin",
      username: "reporting",
      password: { source: "provided", value: "secret" },
    },
    encryption: "mandatory",
    trustServerCertificate: false,
    connectTimeoutSeconds: 15,
  };
}

function everything(): InspectionOptions {
  return {
    schemas: [],
    includeViews: true,
    includeProgrammability: true,
    includeModuleDefinitions: true,
  };
}
