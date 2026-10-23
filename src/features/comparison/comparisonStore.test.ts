import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenedProject, ProjectComparison, SourceLineDiff } from "@/shared/contracts";
import { comparisonDocumentFixture, comparisonFixture } from "./comparisonFixtures";

const projectBackend = vi.hoisted(() => ({ pickProjectToOpen: vi.fn(), readProject: vi.fn() }));
const comparisonBackend = vi.hoisted(() => ({
  compare: vi.fn(),
  compareSource: vi.fn(),
  cancel: vi.fn(),
}));
const exportBackend = vi.hoisted(() => ({ pickDestination: vi.fn(), exportDiagram: vi.fn() }));
vi.mock("@/shared/ipc/projectBackend", () => ({
  PROJECT_FILE_EXTENSION: "scraft",
  getProjectBackend: () => Promise.resolve(projectBackend),
}));
vi.mock("@/shared/ipc/comparisonBackend", () => ({
  getComparisonBackend: () => Promise.resolve(comparisonBackend),
}));
vi.mock("@/shared/ipc/exportBackend", () => ({
  getExportBackend: () => Promise.resolve(exportBackend),
}));
const { useComparisonStore } = await import("./comparisonStore");

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const labels = { title: "Choose", fileTypeName: "Project" };

beforeEach(() => {
  useComparisonStore.getState().close();
  vi.resetAllMocks();
  useComparisonStore.setState({
    reference: null,
    compared: null,
    comparison: null,
    phase: "idle",
    selectedKey: null,
    saved: false,
  });
  projectBackend.readProject.mockResolvedValue(comparisonDocumentFixture());
  comparisonBackend.compare.mockResolvedValue(comparisonFixture());
  comparisonBackend.cancel.mockResolvedValue(undefined);
  exportBackend.exportDiagram.mockResolvedValue({
    path: "report.html",
    bytes: 42,
    width: null,
    height: null,
  });
  useComparisonStore.getState().open();
});

describe("isolated comparison work", () => {
  it("reads both chosen files directly and keeps their originals unchanged", async () => {
    await useComparisonStore.getState().pick("reference", labels, "reference.scraft");
    await useComparisonStore.getState().pick("compared", labels, "compared.scraft");
    const reference = structuredClone(useComparisonStore.getState().reference);
    await useComparisonStore.getState().compare();
    expect(projectBackend.readProject.mock.calls).toEqual([
      ["reference.scraft"],
      ["compared.scraft"],
    ]);
    expect(useComparisonStore.getState().reference).toEqual(reference);
    expect(comparisonBackend.compare).toHaveBeenCalledOnce();
  });

  it("a cancelled picker preserves the previous comparison and file", async () => {
    await useComparisonStore.getState().pick("reference", labels, "reference.scraft");
    projectBackend.pickProjectToOpen.mockResolvedValue(null);
    const before = useComparisonStore.getState().reference;
    await useComparisonStore.getState().pick("reference", labels);
    expect(useComparisonStore.getState().reference).toBe(before);
    expect(projectBackend.readProject).toHaveBeenCalledOnce();
  });

  it("closing or selecting a newer file invalidates late file and comparison results", async () => {
    const old = deferred<OpenedProject>();
    projectBackend.readProject.mockReturnValueOnce(old.promise);
    const first = useComparisonStore.getState().pick("reference", labels, "old.scraft");
    await Promise.resolve();
    await useComparisonStore.getState().pick("reference", labels, "new.scraft");
    old.resolve(comparisonDocumentFixture());
    await first;
    expect(useComparisonStore.getState().reference?.path).toBe("new.scraft");
    await useComparisonStore.getState().pick("compared", labels, "compared.scraft");
    const pending = deferred<ProjectComparison>();
    comparisonBackend.compare.mockReturnValueOnce(pending.promise);
    const request = useComparisonStore.getState().compare();
    useComparisonStore.getState().close();
    pending.resolve(comparisonFixture());
    await request;
    expect(useComparisonStore.getState().comparison).toBeNull();
    expect(useComparisonStore.getState().isOpen).toBe(false);
  });

  it("saves the reviewed report exactly and never writes either input project", async () => {
    useComparisonStore.getState().previewReport("<html>REVIEWED_SAFE_BYTES</html>");
    exportBackend.pickDestination.mockResolvedValue("report.html");
    await useComparisonStore.getState().saveReport("Save reviewed report");
    expect(exportBackend.exportDiagram.mock.calls[0]?.[0]).toEqual({
      format: "html",
      destination: "report.html",
      document: "<html>REVIEWED_SAFE_BYTES</html>",
      scale: 1,
    });
    expect(useComparisonStore.getState().saved).toBe(true);
    expect(projectBackend.readProject).not.toHaveBeenCalled();
  });

  it("late source job IDs are cancelled after closing rather than resurrecting a source view", async () => {
    const pending = deferred<SourceLineDiff>();
    let started: (job: string) => void = () => undefined;
    comparisonBackend.compareSource.mockImplementation(
      (
        _reference: string,
        _compared: string,
        _options: unknown,
        onStarted: (job: string) => void,
      ) => {
        started = onStarted;
        return pending.promise;
      },
    );
    const document = comparisonDocumentFixture();
    document.project.snapshot.views.push({
      name: { schema: "sales", name: "Summary" },
      columns: [],
    });
    document.project.snapshot.programmability = {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      routines: [],
      triggers: [],
      views: [
        {
          view: { schema: "sales", name: "Summary" },
          definition: { status: "readable", text: "SELECT 1" },
          hasCheckOption: false,
          isIndexed: false,
        },
      ],
    };
    projectBackend.readProject.mockResolvedValue(document);
    const comparison = comparisonFixture();
    const item = comparison.items[0];
    if (!item) throw new Error("missing fixture");
    item.object.kind = "view";
    item.object.name.name = "Summary";
    comparisonBackend.compare.mockResolvedValue(comparison);
    await useComparisonStore.getState().pick("reference", labels, "a.scraft");
    await useComparisonStore.getState().pick("compared", labels, "b.scraft");
    await useComparisonStore.getState().compare();
    const work = useComparisonStore.getState().loadSource();
    await Promise.resolve();
    useComparisonStore.getState().close();
    started("comparison-1");
    pending.resolve({
      status: "complete",
      exactEqual: true,
      equalUnderLegacyNormalization: true,
      lines: [],
      totalRows: 0,
      nextOffset: null,
    });
    await work;
    expect(comparisonBackend.cancel).toHaveBeenCalledWith("comparison-1");
    expect(useComparisonStore.getState().source).toBeNull();
  });
});
