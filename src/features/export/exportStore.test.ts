import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Column,
  ConnectionSettings,
  ExportEvent,
  ExportOutcome,
  ExportRequest,
  SchemaSnapshot,
} from "@/shared/contracts";
import type { Locale } from "@/shared/i18n/locales";
import type { ExportFileType } from "@/shared/ipc/exportBackend";
import type { ThemePreference } from "@/shared/settings/theme";

import { DEFAULT_CHOICES } from "./exportSpecification";
import type { ExportLabels } from "./exportStore";

const exportBackend = vi.hoisted(() => ({
  pickDestination:
    vi.fn<(title: string, suggested: string, fileType: ExportFileType) => Promise<string | null>>(),
  exportDiagram:
    vi.fn<
      (request: ExportRequest, onEvent: (event: ExportEvent) => void) => Promise<ExportOutcome>
    >(),
  cancelExport: vi.fn(),
  revealInFolder: vi.fn(),
}));

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

/** The settings the store reads; tests change them in place. */
const settings = vi.hoisted((): { locale: Locale; themePreference: ThemePreference } => ({
  locale: "es",
  themePreference: "system",
}));

const systemPrefersDark = vi.hoisted(() => ({ matches: true }));

vi.mock("@/shared/ipc/exportBackend", () => ({
  getExportBackend: () => Promise.resolve(exportBackend),
}));

vi.mock("@/shared/ipc/projectBackend", () => ({
  PROJECT_FILE_EXTENSION: "scraft",
  getProjectBackend: () => Promise.resolve(projectBackend),
}));

vi.mock("@/shared/ipc/preferencesBackend", () => ({
  getPreferencesBackend: () => Promise.resolve(preferencesBackend),
}));

vi.mock("@/shared/settings/settingsStore", () => ({
  useSettingsStore: { getState: () => settings },
}));

// The fonts are bundled assets; what matters here is that they reach the document when asked.
vi.mock("./fontFaces", () => ({
  loadEmbeddedFontFaces: () => Promise.resolve("@font-face{font-family:Inter}"),
}));

// The node environment has no window; the store asks it for the system colour scheme.
vi.stubGlobal("window", { matchMedia: () => systemPrefersDark });

const { useProjectStore } = await import("@/features/project/projectStore");
const { useExportStore } = await import("./exportStore");

function column(name: string): Column {
  return {
    name,
    ordinalPosition: 0,
    dataType: {
      name: "int",
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable: false,
    defaultExpression: null,
    isIdentity: false,
    isComputed: false,
  };
}

const snapshot: SchemaSnapshot = {
  databaseName: "Shop",
  serverVersion: null,
  extractedAt: "2026-10-13T18:00:00Z",
  tables: [
    {
      name: { schema: "dbo", name: "Customers" },
      columns: [column("CustomerId"), column("Name"), column("Email")],
      primaryKey: { name: "PK_Customers", columns: ["CustomerId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
    {
      name: { schema: "sales", name: "Orders" },
      columns: [column("OrderId"), column("CustomerId")],
      primaryKey: { name: "PK_Orders", columns: ["OrderId"], isClustered: true },
      indexes: [],
      checkConstraints: [],
    },
  ],
  views: [{ name: { schema: "sales", name: "RecentOrders" }, columns: [column("OrderId")] }],
  foreignKeys: [
    {
      name: "FK_Orders_Customers",
      referencingTable: { schema: "sales", name: "Orders" },
      referencedTable: { schema: "dbo", name: "Customers" },
      columnPairs: [{ referencingColumn: "CustomerId", referencedColumn: "CustomerId" }],
      onDelete: "noAction",
      onUpdate: "noAction",
      isEnabled: true,
    },
  ],
};

const connection: ConnectionSettings = {
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

const labels: ExportLabels = {
  dialogTitle: "Exportar diagrama",
  fileTypeName: "Imagen SVG",
  generator: "SchemaCraft 1.1.0",
};

const outcome: ExportOutcome = {
  path: "C:\\out\\shop.svg",
  bytes: 1234,
  width: null,
  height: null,
};

function openProject(capture: SchemaSnapshot = snapshot): void {
  useProjectStore.getState().loadFromInspection(capture, connection, {
    schemas: [],
    includeViews: true,
    includeProgrammability: true,
    includeModuleDefinitions: true,
  });
}

/** The document the store handed to the Rust side in its last export. */
function exportedRequest(): ExportRequest {
  const request = exportBackend.exportDiagram.mock.calls.at(-1)?.[0];
  if (request === undefined) {
    throw new Error("no export was sent");
  }
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.locale = "es";
  settings.themePreference = "system";
  systemPrefersDark.matches = true;
  exportBackend.exportDiagram.mockResolvedValue(outcome);
  useProjectStore.setState({
    project: null,
    phase: "idle",
    failure: null,
    pendingDiscard: null,
    history: { past: [], future: [] },
  });
  useExportStore.setState({
    isOpen: false,
    choices: DEFAULT_CHOICES,
    extent: null,
    phase: "idle",
    progress: null,
    outcome: null,
    failure: null,
  });
});

describe("open", () => {
  it("preselects the canvas detail level and the theme in use, and measures the diagram", () => {
    openProject();
    useProjectStore.getState().setDetailLevel("full");

    useExportStore.getState().open();

    const { isOpen, choices, extent } = useExportStore.getState();
    expect(isOpen).toBe(true);
    expect(choices.detailLevel).toBe("full");
    expect(choices.theme).toBe("dark");
    expect(extent?.entityCount).toBe(3);
    expect(extent?.relationCount).toBe(1);
  });

  it("follows an explicit theme preference and the choices passed in", () => {
    openProject();
    settings.themePreference = "light";
    systemPrefersDark.matches = true;

    useExportStore.getState().open({ format: "png", scale: 4 });

    const { choices } = useExportStore.getState();
    expect(choices.theme).toBe("light");
    expect(choices.format).toBe("png");
    expect(choices.scale).toBe(4);
    expect(choices.detailLevel).toBe("keys");
  });

  it("stays closed without a project", () => {
    useExportStore.getState().open();
    expect(useExportStore.getState().isOpen).toBe(false);
    expect(useExportStore.getState().extent).toBeNull();
  });
});

describe("updateChoices", () => {
  it("measures again only when the detail level changes", () => {
    openProject();
    useExportStore.getState().open();
    const measured = useExportStore.getState().extent;

    useExportStore.getState().updateChoices({ format: "pdf", theme: "light" });
    expect(useExportStore.getState().extent).toBe(measured);
    expect(useExportStore.getState().choices.format).toBe("pdf");

    useExportStore.getState().updateChoices({ detailLevel: "full" });
    const taller = useExportStore.getState().extent;
    expect(taller).not.toBe(measured);
    expect(taller?.height ?? 0).toBeGreaterThan(measured?.height ?? 0);
    expect(taller?.entityCount).toBe(3);
  });
});

describe("runExport", () => {
  it("writes to the given destination an SVG whose view card speaks the application's language", async () => {
    openProject();
    useExportStore.getState().open();

    await useExportStore.getState().runExport({ ...labels, destination: "C:\\out\\shop" });

    expect(exportBackend.pickDestination).not.toHaveBeenCalled();
    const request = exportedRequest();
    expect(request.format).toBe("svg");
    expect(request.destination).toBe("C:\\out\\shop.svg");
    expect(request.scale).toBe(1);
    expect(request.document.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(request.document).toContain('data-entity="sales.RecentOrders"');
    expect(request.document).toContain(">VISTA</text>");
    expect(request.document).not.toContain(">VIEW<");
    expect(request.document).toContain("<style>@font-face{font-family:Inter}");
    expect(request.document).toContain("with SchemaCraft 1.1.0</desc>");
    expect(request.document).toContain("No se leyeron los desencadenadores de este diagrama.");
    expect(useExportStore.getState().outcome).toEqual(outcome);
    expect(useExportStore.getState().phase).toBe("idle");
  });

  it("draws the English label when the application is in English", async () => {
    openProject();
    settings.locale = "en";
    useExportStore.getState().open({ embedFonts: false });

    await useExportStore.getState().runExport({ ...labels, destination: "C:\\out\\shop.svg" });

    const request = exportedRequest();
    expect(request.destination).toBe("C:\\out\\shop.svg");
    expect(request.document).toContain(">VIEW</text>");
    expect(request.document).not.toContain("@font-face");
  });

  it("passes translated trigger counts and legends to every static format without code or names", async () => {
    const capture: SchemaSnapshot = {
      ...snapshot,
      programmability: {
        capture: { objects: { status: "read" }, definitions: { status: "read" } },
        routines: [],
        views: [],
        triggers: [
          {
            parent: { schema: "dbo", name: "Customers" },
            name: "trg_PrivateName",
            timing: "insteadOf",
            events: [{ event: "insert", order: "unspecified" }],
            isEnabled: true,
            isNotForReplication: false,
            body: {
              language: "sql",
              definition: { status: "readable", text: "PRIVATE_BODY_SENTINEL" },
            },
          },
        ],
      },
    };
    for (const locale of ["en", "es"] as const) {
      settings.locale = locale;
      for (const format of ["svg", "pdf", "png"] as const) {
        openProject(capture);
        useExportStore.getState().open({ format, embedFonts: false });
        await useExportStore
          .getState()
          .runExport({ ...labels, destination: `C:\\out\\triggers.${format}` });
        const request = exportBackend.exportDiagram.mock.calls.at(-1)?.[0];
        expect(request?.format).toBe(format);
        expect(request?.document).toContain(
          locale === "en" ? "1 trigger is enabled." : "1 desencadenador está habilitado.",
        );
        expect(request?.document).toContain(
          locale === "en" ? "Trigger badge:" : "Indicador de desencadenadores:",
        );
        expect(request?.document).toContain("INSTEAD OF");
        expect(request?.document).not.toContain("trg_PrivateName");
        expect(request?.document).not.toContain("PRIVATE_BODY_SENTINEL");
      }
    }
  });

  it("does not add a trigger note when the read established that there are no triggers", async () => {
    openProject({
      ...snapshot,
      programmability: {
        capture: { objects: { status: "read" }, definitions: { status: "read" } },
        routines: [],
        views: [],
        triggers: [],
      },
    });
    useExportStore.getState().open({ embedFonts: false });
    await useExportStore.getState().runExport({ ...labels, destination: "C:\\out\\empty.svg" });
    expect(exportedRequest().document).not.toContain("sc-footnote");
  });

  it("asks for a destination when none is given and stops when the dialog is cancelled", async () => {
    openProject();
    useExportStore.getState().open();
    exportBackend.pickDestination.mockResolvedValue(null);

    await useExportStore.getState().runExport(labels);

    expect(exportBackend.pickDestination).toHaveBeenCalledWith(
      "Exportar diagrama",
      "Shop-diagram.svg",
      { name: "Imagen SVG", extension: "svg" },
    );
    expect(exportBackend.exportDiagram).not.toHaveBeenCalled();
    expect(useExportStore.getState().phase).toBe("idle");
  });

  it("ignores close while the export runs and follows the job's progress", async () => {
    openProject();
    useExportStore.getState().open();
    let finish: (value: ExportOutcome) => void = () => undefined;
    exportBackend.exportDiagram.mockImplementation((_request, onEvent) => {
      onEvent({ event: "started", data: { jobId: "job-1" } });
      onEvent({ event: "progress", data: "writing" });
      return new Promise<ExportOutcome>((resolve) => {
        finish = resolve;
      });
    });

    const running = useExportStore.getState().runExport({ ...labels, destination: "C:\\out\\a" });
    await vi.waitFor(() => {
      expect(useExportStore.getState().progress?.jobId).toBe("job-1");
    });
    expect(useExportStore.getState().phase).toBe("exporting");
    expect(useExportStore.getState().progress?.stage).toBe("writing");

    useExportStore.getState().close();
    expect(useExportStore.getState().isOpen).toBe(true);

    finish(outcome);
    await running;
    expect(useExportStore.getState().phase).toBe("idle");
    expect(useExportStore.getState().progress).toBeNull();
    expect(useExportStore.getState().outcome).toEqual(outcome);

    useExportStore.getState().close();
    expect(useExportStore.getState().isOpen).toBe(false);
  });

  it("reports a failed export and lets the dialog close again", async () => {
    openProject();
    useExportStore.getState().open();
    exportBackend.exportDiagram.mockRejectedValue(new Error("the renderer rejected the document"));

    await useExportStore.getState().runExport({ ...labels, destination: "C:\\out\\a" });

    const { failure, phase, outcome: none } = useExportStore.getState();
    expect(phase).toBe("idle");
    expect(none).toBeNull();
    expect(failure?.message).toBe("the renderer rejected the document");

    useExportStore.getState().close();
    expect(useExportStore.getState().isOpen).toBe(false);
    expect(useExportStore.getState().failure).toBeNull();
  });
});
