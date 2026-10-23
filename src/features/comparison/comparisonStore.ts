import { create } from "zustand";

import type { ProjectComparison, SourceLineDiff } from "@/shared/contracts";
import { getComparisonBackend } from "@/shared/ipc/comparisonBackend";
import { getExportBackend } from "@/shared/ipc/exportBackend";
import { toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { getProjectBackend } from "@/shared/ipc/projectBackend";
import type { FileDialogLabels } from "@/shared/ipc/projectBackend";

import {
  comparisonKey,
  comparisonSource,
  EMPTY_COMPARISON_FILTERS,
  filteredComparisonItems,
} from "./comparisonModel";
import type { ComparisonFilters, ComparisonInput } from "./comparisonModel";

type Side = "reference" | "compared";
type Phase = "idle" | "choosing" | "comparing" | "source" | "saving";

interface ComparisonState {
  isOpen: boolean;
  reference: ComparisonInput | null;
  compared: ComparisonInput | null;
  comparison: ProjectComparison | null;
  phase: Phase;
  filters: ComparisonFilters;
  selectedKey: string | null;
  contextSide: Side;
  source: SourceLineDiff | null;
  sourceJob: string | null;
  reportPreview: string | null;
  saved: boolean;
  failure: OperationError | null;
  open: () => void;
  close: () => void;
  pick: (side: Side, labels: FileDialogLabels, path?: string) => Promise<void>;
  compare: () => Promise<void>;
  swap: () => Promise<void>;
  select: (key: string) => void;
  filter: (patch: Partial<ComparisonFilters>) => void;
  setContextSide: (side: Side) => void;
  loadSource: (offset?: number) => Promise<void>;
  cancelSource: () => void;
  previewReport: (document: string) => void;
  clearPreview: () => void;
  saveReport: (title: string) => Promise<void>;
}

/** Comparison is transient and has no dependency on project, preference or connection stores. */
export const useComparisonStore = create<ComparisonState>()((set, get) => {
  let revision = 0;
  let sourceRevision = 0;
  const cancelJob = () => {
    sourceRevision += 1;
    const jobId = get().sourceJob;
    set({ sourceJob: null });
    if (jobId !== null)
      void getComparisonBackend()
        .then((backend) => backend.cancel(jobId))
        .catch(() => undefined);
  };
  return {
    isOpen: false,
    reference: null,
    compared: null,
    comparison: null,
    phase: "idle",
    filters: { ...EMPTY_COMPARISON_FILTERS },
    selectedKey: null,
    contextSide: "compared",
    source: null,
    sourceJob: null,
    reportPreview: null,
    saved: false,
    failure: null,
    open: () => {
      set({ isOpen: true });
    },
    close: () => {
      revision += 1;
      cancelJob();
      set({ isOpen: false, phase: "idle", source: null, reportPreview: null, failure: null });
    },
    pick: async (side, labels, path) => {
      const current = ++revision;
      cancelJob();
      set({ phase: "choosing", failure: null, source: null, reportPreview: null, saved: false });
      try {
        const backend = await getProjectBackend();
        const chosen = path ?? (await backend.pickProjectToOpen(labels));
        if (chosen === null || current !== revision || !get().isOpen) return;
        const document = await backend.readProject(chosen);
        if (current !== revision || !get().isOpen) return;
        set({
          [side]: { path: chosen, document },
          comparison: null,
          selectedKey: null,
          filters: { ...EMPTY_COMPARISON_FILTERS },
        });
      } catch (error: unknown) {
        if (current === revision && get().isOpen) set({ failure: toOperationError(error) });
      } finally {
        if (current === revision) set({ phase: "idle" });
      }
    },
    compare: async () => {
      const { reference, compared } = get();
      if (reference === null || compared === null) return;
      const current = ++revision;
      cancelJob();
      set({ phase: "comparing", failure: null, source: null, reportPreview: null, saved: false });
      try {
        const comparison = await (
          await getComparisonBackend()
        ).compare(reference.document.project.snapshot, compared.document.project.snapshot);
        if (current !== revision || !get().isOpen) return;
        set({
          comparison,
          selectedKey: comparison.items[0] ? comparisonKey(comparison.items[0].object) : null,
          filters: { ...EMPTY_COMPARISON_FILTERS },
        });
      } catch (error: unknown) {
        if (current === revision && get().isOpen) set({ failure: toOperationError(error) });
      } finally {
        if (current === revision) set({ phase: "idle" });
      }
    },
    swap: async () => {
      const { reference, compared } = get();
      revision += 1;
      cancelJob();
      set({
        reference: compared,
        compared: reference,
        comparison: null,
        selectedKey: null,
        reportPreview: null,
        source: null,
      });
      if (reference !== null && compared !== null) await get().compare();
    },
    select: (key) => {
      cancelJob();
      set({ selectedKey: key, source: null, phase: "idle" });
    },
    filter: (patch) => {
      cancelJob();
      const filters = { ...get().filters, ...patch };
      const visible = filteredComparisonItems(get().comparison?.items ?? [], filters);
      const selectedKey = visible.some((item) => comparisonKey(item.object) === get().selectedKey)
        ? get().selectedKey
        : visible[0]
          ? comparisonKey(visible[0].object)
          : null;
      set({ filters, selectedKey, source: null, phase: "idle", reportPreview: null, saved: false });
    },
    setContextSide: (contextSide) => {
      set({ contextSide });
    },
    loadSource: async (offset = 0) => {
      const state = get();
      const item = state.comparison?.items.find(
        (item) => comparisonKey(item.object) === state.selectedKey,
      );
      if (!item || !state.reference || !state.compared) return;
      const reference = comparisonSource(state.reference.document.project.snapshot, item.object);
      const compared = comparisonSource(state.compared.document.project.snapshot, item.object);
      if (reference === null || compared === null) return;
      cancelJob();
      const current = sourceRevision;
      set({ phase: "source", failure: null, source: null });
      try {
        const backend = await getComparisonBackend();
        const source = await backend.compareSource(
          reference,
          compared,
          { offset, limit: 500, maxWork: 4_000_000 },
          (sourceJob) => {
            if (current !== sourceRevision || !get().isOpen) {
              void backend.cancel(sourceJob).catch(() => undefined);
              return;
            }
            set({ sourceJob });
          },
        );
        if (current !== sourceRevision || !get().isOpen) return;
        set({ source, sourceJob: null });
      } catch (error: unknown) {
        if (current === sourceRevision && get().isOpen)
          set({ failure: toOperationError(error), sourceJob: null });
      } finally {
        if (current === sourceRevision) set({ phase: "idle" });
      }
    },
    cancelSource: () => {
      cancelJob();
      set({ phase: "idle", source: null });
    },
    previewReport: (reportPreview) => {
      set({ reportPreview, saved: false });
    },
    clearPreview: () => {
      set({ reportPreview: null });
    },
    saveReport: async (title) => {
      const document = get().reportPreview;
      if (document === null) return;
      const current = revision;
      set({ phase: "saving", failure: null, saved: false });
      try {
        const backend = await getExportBackend();
        const destination = await backend.pickDestination(title, "schema-comparison.html", {
          name: "HTML",
          extension: "html",
        });
        if (destination === null || current !== revision || !get().isOpen) return;
        await backend.exportDiagram(
          { format: "html", destination, document, scale: 1 },
          () => undefined,
        );
        if (current === revision && get().isOpen) set({ saved: true });
      } catch (error: unknown) {
        if (current === revision && get().isOpen) set({ failure: toOperationError(error) });
      } finally {
        if (current === revision) set({ phase: "idle" });
      }
    },
  };
});
