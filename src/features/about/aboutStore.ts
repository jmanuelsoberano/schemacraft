import { create } from "zustand";

import { openLogFolder } from "@/shared/ipc/appInfo";
import { toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";

interface AboutState {
  isOpen: boolean;
  /** Why the diagnostic log folder did not open, shown in the dialog until it closes. */
  logFolderFailure: OperationError | null;
  open: () => void;
  close: () => void;
  /** Opens the log folder; a failure opens the dialog, which says what went wrong. */
  openLogFolder: () => Promise<void>;
}

/** Visibility of the About dialog, shared by the status bar and the action registry. */
export const useAboutStore = create<AboutState>()((set) => ({
  isOpen: false,
  logFolderFailure: null,
  open: () => {
    set({ isOpen: true });
  },
  close: () => {
    set({ isOpen: false, logFolderFailure: null });
  },
  openLogFolder: async () => {
    try {
      await openLogFolder();
      set({ logFolderFailure: null });
    } catch (caught: unknown) {
      set({ isOpen: true, logFolderFailure: toOperationError(caught) });
    }
  },
}));
