import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticReport } from "@/shared/contracts";
import { OperationError } from "@/shared/ipc/operationError";

const backend = vi.hoisted(() => ({
  readReport: vi.fn(),
  pickDestination: vi.fn(),
  writeReport: vi.fn(),
  openPage: vi.fn(),
  revealInFolder: vi.fn(),
}));
vi.mock("@/shared/ipc/supportBackend", () => ({
  getSupportBackend: () => Promise.resolve(backend),
}));
const { useSupportStore } = await import("./supportStore");

const report: DiagnosticReport = {
  text: "SchemaCraft diagnostic report\nREVIEWED_LOCAL_TEXT\n",
  logCount: 2,
  truncatedLogCount: 0,
  unavailableLogCount: 0,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  useSupportStore.setState({ isSaving: false, isOpeningPage: false });
  useSupportStore.getState().close();
  backend.readReport.mockResolvedValue(report);
  backend.writeReport.mockResolvedValue(undefined);
  backend.openPage.mockResolvedValue(undefined);
});

describe("local support diagnostics", () => {
  it("opening reads a preview and neither saves nor opens a website", async () => {
    await useSupportStore.getState().open();
    expect(useSupportStore.getState()).toMatchObject({ isOpen: true, report, isLoading: false });
    expect(backend.readReport).toHaveBeenCalledOnce();
    expect(backend.writeReport).not.toHaveBeenCalled();
    expect(backend.openPage).not.toHaveBeenCalled();
  });

  it("saves exactly the reviewed snapshot and never recollects logs while saving", async () => {
    await useSupportStore.getState().open();
    backend.readReport.mockResolvedValue({ ...report, text: "LATER_LOG_CONTENTS" });
    backend.pickDestination.mockResolvedValue("C:\\reports\\diagnostic.txt");
    await useSupportStore.getState().saveReport("Save", "Text");
    expect(backend.writeReport).toHaveBeenCalledWith("C:\\reports\\diagnostic.txt", report.text);
    expect(backend.readReport).toHaveBeenCalledOnce();
    expect(backend.openPage).not.toHaveBeenCalled();
    expect(useSupportStore.getState().savedPath).toBe("C:\\reports\\diagnostic.txt");
  });

  it("cancelling the native save dialog writes nothing and keeps the preview", async () => {
    await useSupportStore.getState().open();
    backend.pickDestination.mockResolvedValue(null);
    await useSupportStore.getState().saveReport("Save", "Text");
    expect(backend.writeReport).not.toHaveBeenCalled();
    expect(useSupportStore.getState()).toMatchObject({
      report,
      savedPath: null,
      isSaving: false,
      failure: null,
    });
  });

  it("keeps the reviewed text after a write failure and permits another destination", async () => {
    await useSupportStore.getState().open();
    backend.pickDestination.mockResolvedValue("C:\\reports\\diagnostic.txt");
    const failure = new OperationError({ type: "support", value: "writeFailed" }, "save failed");
    backend.writeReport.mockRejectedValueOnce(failure);
    await useSupportStore.getState().saveReport("Save", "Text");
    expect(useSupportStore.getState()).toMatchObject({
      report,
      failure,
      isSaving: false,
      savedPath: null,
    });
    await useSupportStore.getState().saveReport("Save", "Text");
    expect(useSupportStore.getState().failure).toBeNull();
  });

  it("a loading failure leaves public reporting available without an attachment", async () => {
    backend.readReport.mockRejectedValue(
      new OperationError({ type: "support", value: "readFailed" }, "read failed"),
    );
    await useSupportStore.getState().open();
    expect(useSupportStore.getState()).toMatchObject({ report: null, isLoading: false });
    await useSupportStore.getState().openPage("bugReport");
    expect(backend.openPage).toHaveBeenCalledWith("bugReport");
    expect(backend.openPage.mock.calls[0]).toEqual(["bugReport"]);
  });

  it("opening either fixed support page passes no report text, path or user data", async () => {
    await useSupportStore.getState().open();
    await useSupportStore.getState().openPage("bugReport");
    await useSupportStore.getState().openPage("securityPolicy");
    expect(backend.openPage.mock.calls).toEqual([["bugReport"], ["securityPolicy"]]);
    expect(backend.writeReport).not.toHaveBeenCalled();
  });

  it("late loading cannot restore a closed preview or overwrite a more recent one", async () => {
    const first = deferred<DiagnosticReport>();
    backend.readReport.mockReturnValueOnce(first.promise);
    const opening = useSupportStore.getState().open();
    await Promise.resolve();
    useSupportStore.getState().close();
    await useSupportStore.getState().open();
    first.resolve({ ...report, text: "STALE_REPORT" });
    await opening;
    expect(useSupportStore.getState().report).toEqual(report);
    useSupportStore.getState().close();
    expect(useSupportStore.getState()).toMatchObject({
      isOpen: false,
      report: null,
      savedPath: null,
    });
  });

  it("does not open two save dialogs or dismiss the report while a save is pending", async () => {
    await useSupportStore.getState().open();
    const destination = deferred<string | null>();
    backend.pickDestination.mockReturnValueOnce(destination.promise);
    const saving = useSupportStore.getState().saveReport("Save", "Text");
    await Promise.resolve();
    await useSupportStore.getState().saveReport("Save", "Text");
    useSupportStore.getState().close();
    expect(useSupportStore.getState().isOpen).toBe(true);
    expect(backend.pickDestination).toHaveBeenCalledOnce();
    destination.resolve(null);
    await saving;
    useSupportStore.getState().close();
    expect(useSupportStore.getState().isOpen).toBe(false);
  });
});
