import { beforeEach, describe, expect, it, vi } from "vitest";

import { personas } from "@/features/access/testFixtures";
import type {
  AccessProfile,
  ConnectionSettings,
  DatabaseDescription,
  InspectionEvent,
  InspectionOptions,
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
  readProject: vi.fn(),
  writeProject: vi.fn(),
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

const { canReadSchema, useConnectionStore } = await import("./connectionStore");
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
    summary: { tables: noChanges, views: noChanges, foreignKeys: noChanges },
    notChecked: [],
    nowAvailable: [],
    accessChanged: false,
    ...partial,
  };
}

const emptyPreferences = { formatVersion: 1, recentConnections: [], recentProjects: [] };

/** Fills the form for a SQL login and tests the connection to a server with one database. */
async function testedAgainstShop(access: AccessProfile): Promise<void> {
  connectionBackend.testConnection.mockResolvedValue(server);
  connectionBackend.listDatabases.mockResolvedValue(["Shop"]);
  connectionBackend.describeDatabase.mockResolvedValue({ schemas: ["dbo", "sales"], access });
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
    resolve({ schemas: ["dbo"], access: personas.owner });
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
  return { schemas: [], includeViews: true };
}
