import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationError } from "@/shared/ipc/operationError";

const openLogFolder = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@/shared/ipc/appInfo", () => ({ openLogFolder }));

const { useAboutStore } = await import("./aboutStore");

beforeEach(() => {
  openLogFolder.mockReset();
  useAboutStore.setState({ isOpen: false, logFolderFailure: null });
});

describe("the about store", () => {
  it("opens the log folder without opening the dialog", async () => {
    openLogFolder.mockResolvedValue(undefined);
    await useAboutStore.getState().openLogFolder();
    expect(openLogFolder).toHaveBeenCalledOnce();
    expect(useAboutStore.getState()).toMatchObject({ isOpen: false, logFolderFailure: null });
  });

  it("opens the dialog with the failure when the folder does not open, and forgets it on close", async () => {
    const failure = new OperationError({ type: "invalidArgument" }, "no diagnostic log");
    openLogFolder.mockRejectedValue(failure);
    await useAboutStore.getState().openLogFolder();
    expect(useAboutStore.getState()).toMatchObject({ isOpen: true, logFolderFailure: failure });

    useAboutStore.getState().close();
    expect(useAboutStore.getState()).toMatchObject({ isOpen: false, logFolderFailure: null });
  });
});
