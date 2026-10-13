import { create } from "zustand";

import { useProjectStore } from "@/features/project/projectStore";
import type { ExportEvent, ExportOutcome, ExportRequest, ExportStage } from "@/shared/contracts";
import { getExportBackend } from "@/shared/ipc/exportBackend";
import { toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { DARK_SCHEME_MEDIA_QUERY, resolveTheme } from "@/shared/settings/theme";

import {
  DEFAULT_CHOICES,
  ExportSpecificationBuilder,
  FILE_EXTENSIONS,
  suggestedFileName,
} from "./exportSpecification";
import type { ExportChoices, ExportSpecification } from "./exportSpecification";
import { loadEmbeddedFontFaces } from "./fontFaces";
import { buildStandalonePage } from "./html/buildStandalonePage";
import { visibleProjection } from "./html/viewerData";
import type { ExportTheme } from "./svg/palette";
import { measureDiagram, renderDiagramSvg } from "./svg/renderDiagram";
import type { DiagramExtent, DiagramInput } from "./svg/renderDiagram";
import { createCanvasMeasurer } from "./svg/text";

export type ExportProgressStage = "preparing" | ExportStage;

export interface ExportProgress {
  /** Known once the Rust side reports it; needed to cancel. */
  jobId: string | null;
  stage: ExportProgressStage;
  isCancelling: boolean;
}

/** Translated strings the store needs when it talks to the native dialogs and the file. */
export interface ExportLabels {
  dialogTitle: string;
  fileTypeName: string;
  /** Name and version written into the file, e.g. "SchemaCraft 0.1.0". */
  generator: string;
  /** Skips the save dialog and writes here; for scripted checks against a running build. */
  destination?: string;
}

interface ExportState {
  isOpen: boolean;
  choices: ExportChoices;
  /** Size of the diagram for the current choices, for the summary and the limits. */
  extent: DiagramExtent | null;
  phase: "idle" | "exporting";
  progress: ExportProgress | null;
  outcome: ExportOutcome | null;
  failure: OperationError | null;
  open: () => void;
  close: () => void;
  updateChoices: (patch: Partial<ExportChoices>) => void;
  runExport: (labels: ExportLabels) => Promise<void>;
  cancel: () => Promise<void>;
  reveal: () => Promise<void>;
  exportAnother: () => void;
}

function currentDiagram(): DiagramInput | null {
  const { project } = useProjectStore.getState();
  return project === null
    ? null
    : { snapshot: project.content.snapshot, canvas: project.content.canvas };
}

function currentTheme(): ExportTheme {
  return resolveTheme(
    useSettingsStore.getState().themePreference,
    window.matchMedia(DARK_SCHEME_MEDIA_QUERY).matches,
  );
}

/** Makes sure the static faces the exporter measures with are loaded in this document. */
async function ensureMeasurementFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return;
  }
  await Promise.all(
    [
      '400 12px "Inter"',
      '600 12px "Inter"',
      '400 12px "JetBrains Mono"',
      '600 12px "JetBrains Mono"',
    ].map((font) => document.fonts.load(font)),
  );
}

/** The document the Rust side writes or renders: an SVG, or the complete HTML page. */
async function buildDocument(
  specification: ExportSpecification,
  diagram: DiagramInput,
  labels: ExportLabels,
  exportedAt: string,
): Promise<string> {
  await ensureMeasurementFonts();
  const measureText = createCanvasMeasurer() ?? undefined;
  const fontFaces = specification.embedFonts ? await loadEmbeddedFontFaces() : "";
  const { detailLevel, theme } = specification;
  if (specification.format === "html") {
    const { viewerScript, viewerStyles } = await import("virtual:schemacraft-viewer");
    return buildStandalonePage({
      data: {
        generator: labels.generator,
        exportedAt,
        locale: useSettingsStore.getState().locale,
        theme,
        detailLevel,
        ...visibleProjection(diagram.snapshot, diagram.canvas),
      },
      viewerScript,
      viewerStyles,
      fontFaces,
    });
  }
  return renderDiagramSvg(diagram, {
    detailLevel,
    theme,
    fontFaces,
    measureText,
    description: `Exported ${exportedAt} with ${labels.generator}`,
  }).svg;
}

/** The export dialog: choices, the running job and its result. */
export const useExportStore = create<ExportState>()((set, get) => ({
  isOpen: false,
  choices: DEFAULT_CHOICES,
  extent: null,
  phase: "idle",
  progress: null,
  outcome: null,
  failure: null,

  open: () => {
    const diagram = currentDiagram();
    if (diagram === null) {
      return;
    }
    const choices: ExportChoices = {
      ...get().choices,
      detailLevel: diagram.canvas.detailLevel,
      theme: currentTheme(),
    };
    set({
      isOpen: true,
      choices,
      extent: measureDiagram(diagram, choices.detailLevel),
      phase: "idle",
      progress: null,
      outcome: null,
      failure: null,
    });
  },

  close: () => {
    if (get().phase === "exporting") {
      return;
    }
    set({ isOpen: false, failure: null });
  },

  updateChoices: (patch) => {
    const choices = { ...get().choices, ...patch };
    const diagram = currentDiagram();
    set({
      choices,
      extent:
        patch.detailLevel !== undefined && diagram !== null
          ? measureDiagram(diagram, choices.detailLevel)
          : get().extent,
      failure: null,
    });
  },

  runExport: async (labels) => {
    const diagram = currentDiagram();
    if (diagram === null || get().phase === "exporting") {
      return;
    }
    const { choices } = get();
    try {
      const backend = await getExportBackend();
      const destination =
        labels.destination ??
        (await backend.pickDestination(
          labels.dialogTitle,
          suggestedFileName(diagram.snapshot.databaseName, choices.format),
          { name: labels.fileTypeName, extension: FILE_EXTENSIONS[choices.format] },
        ));
      if (destination === null) {
        return;
      }
      const specification = ExportSpecificationBuilder.from(choices).to(destination).build();
      set({
        phase: "exporting",
        progress: { jobId: null, stage: "preparing", isCancelling: false },
        outcome: null,
        failure: null,
      });

      const exportedAt = new Date().toISOString();
      const request: ExportRequest = {
        format: specification.format,
        destination: specification.destination,
        document: await buildDocument(specification, diagram, labels, exportedAt),
        scale: specification.scale,
      };
      const handleEvent = (event: ExportEvent) => {
        set((state) => {
          const progress = state.progress ?? {
            jobId: null,
            stage: "preparing",
            isCancelling: false,
          };
          return {
            progress:
              event.event === "started"
                ? { ...progress, jobId: event.data.jobId }
                : { ...progress, stage: event.data },
          };
        });
      };
      const outcome = await backend.exportDiagram(request, handleEvent);
      set({ phase: "idle", progress: null, outcome });
    } catch (caught: unknown) {
      set({ phase: "idle", progress: null, failure: toOperationError(caught) });
    }
  },

  cancel: async () => {
    const { progress } = get();
    if (progress?.jobId === null || progress === null || progress.isCancelling) {
      return;
    }
    set({ progress: { ...progress, isCancelling: true } });
    try {
      const backend = await getExportBackend();
      await backend.cancelExport(progress.jobId);
    } catch {
      // The export finished before the cancellation arrived; its result is on its way.
    }
  },

  reveal: async () => {
    const { outcome } = get();
    if (outcome === null) {
      return;
    }
    try {
      const backend = await getExportBackend();
      await backend.revealInFolder(outcome.path);
    } catch (caught: unknown) {
      set({ failure: toOperationError(caught) });
    }
  },

  exportAnother: () => {
    set({ outcome: null, failure: null });
  },
}));
