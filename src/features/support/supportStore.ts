import { create } from "zustand";

import type { DiagnosticReport, SupportPage } from "@/shared/contracts";
import { toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { getSupportBackend } from "@/shared/ipc/supportBackend";

interface SupportState {
  isOpen: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isOpeningPage: boolean;
  report: DiagnosticReport | null;
  savedPath: string | null;
  failure: OperationError | null;
  open: () => Promise<void>;
  close: () => void;
  reload: () => Promise<void>;
  saveReport: (title: string, fileType: string) => Promise<void>;
  openPage: (page: SupportPage) => Promise<void>;
  revealSavedReport: () => Promise<void>;
}

/** Ephemeral support state. Closing discards the preview; saving and opening a browser are
 * separate user actions, and neither operation sends the diagnostic contents anywhere. */
export const useSupportStore = create<SupportState>()((set, get) => {
  let generation = 0;
  const busy = () => get().isSaving || get().isOpeningPage;
  return {
    isOpen: false,
    isLoading: false,
    isSaving: false,
    isOpeningPage: false,
    report: null,
    savedPath: null,
    failure: null,
    open: async () => {
      if (get().isOpen) return;
      set({ isOpen: true });
      await get().reload();
    },
    close: () => {
      if (busy()) return;
      generation += 1;
      set({ isOpen: false, isLoading: false, report: null, savedPath: null, failure: null });
    },
    reload: async () => {
      if (!get().isOpen || busy()) return;
      const current = ++generation;
      set({ isLoading: true, report: null, savedPath: null, failure: null });
      try {
        const report = await (await getSupportBackend()).readReport();
        if (current === generation && get().isOpen) set({ report });
      } catch (caught: unknown) {
        if (current === generation && get().isOpen) set({ failure: toOperationError(caught) });
      } finally {
        if (current === generation && get().isOpen) set({ isLoading: false });
      }
    },
    saveReport: async (title, fileType) => {
      const report = get().report;
      if (!get().isOpen || report === null || get().isLoading || busy()) return;
      set({ isSaving: true, failure: null });
      try {
        const backend = await getSupportBackend();
        const destination = await backend.pickDestination(
          title,
          "schemacraft-diagnostic.txt",
          fileType,
        );
        if (destination === null) return;
        await backend.writeReport(destination, report.text);
        set({ savedPath: destination });
      } catch (caught: unknown) {
        set({ failure: toOperationError(caught) });
      } finally {
        set({ isSaving: false });
      }
    },
    openPage: async (page) => {
      if (!get().isOpen || busy()) return;
      set({ isOpeningPage: true, failure: null });
      try {
        await (await getSupportBackend()).openPage(page);
      } catch (caught: unknown) {
        set({ failure: toOperationError(caught) });
      } finally {
        set({ isOpeningPage: false });
      }
    },
    revealSavedReport: async () => {
      const path = get().savedPath;
      if (path === null || busy()) return;
      try {
        await (await getSupportBackend()).revealInFolder(path);
      } catch (caught: unknown) {
        set({ failure: toOperationError(caught) });
      }
    },
  };
});
