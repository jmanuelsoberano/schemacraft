import { create } from "zustand";

import { ensurePlaced, spreadForDetailLevel, withPositions } from "@/features/canvas/canvasState";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { placeRefreshedEntities } from "@/features/canvas/refreshPlacement";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import type {
  CanvasState,
  ConnectionSettings,
  DetailLevel,
  InspectionOptions,
  Project,
  ProjectContent,
  SchemaSnapshot,
} from "@/shared/contracts";
import { translate } from "@/shared/i18n/useI18n";
import { toOperationError } from "@/shared/ipc/operationError";
import type { OperationError } from "@/shared/ipc/operationError";
import { PROJECT_FILE_EXTENSION, getProjectBackend } from "@/shared/ipc/projectBackend";
import { useSettingsStore } from "@/shared/settings/settingsStore";

import { toSavedConnection } from "./savedConnection";

/** The project the window is working on. */
export interface OpenProject {
  /** File the project was opened from or saved to; `null` until the first save. */
  path: string | null;
  content: ProjectContent;
  /**
   * Settings with the in-memory password, while the schema was read in this session. A project
   * opened from a file has none until it is refreshed through the connection dialog.
   */
  liveSettings: ConnectionSettings | null;
  /** When the file was last written, as reported by the Rust side. */
  savedAt: string | null;
  /** Whether the file on disk is behind the project in memory. */
  isDirty: boolean;
  /** Changes whenever a different document is loaded, so the canvas can reset its viewport. */
  loadToken: number;
}

/** Undo and redo stacks of canvas states: the caretaker of the canvas Memento. */
export interface CanvasHistory {
  past: readonly CanvasState[];
  future: readonly CanvasState[];
}

export interface CanvasUpdateOptions {
  /** Whether the change can be undone. Default `true`. */
  undoable?: boolean;
  /** Whether the change marks the project as unsaved. Default `true`. */
  dirty?: boolean;
}

const HISTORY_LIMIT = 100;
const EMPTY_HISTORY: CanvasHistory = { past: [], future: [] };

export type ProjectPhase = "idle" | "opening" | "saving";

export interface ProjectFailure {
  operation: "open" | "save";
  path: string | null;
  error: OperationError;
}

interface ProjectState {
  project: OpenProject | null;
  phase: ProjectPhase;
  failure: ProjectFailure | null;
  /** Action waiting for the user to confirm that unsaved changes may be discarded. */
  pendingDiscard: (() => void) | null;
  history: CanvasHistory;
  /** Replaces the project with a schema just read from a database. */
  loadFromInspection: (
    snapshot: SchemaSnapshot,
    settings: ConnectionSettings,
    inspection: InspectionOptions,
  ) => void;
  /** Opens `path`, or asks for a file when it is omitted. Guarded by unsaved changes. */
  openProject: (path?: string) => void;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  setDetailLevel: (detailLevel: DetailLevel) => void;
  /** Applies a change to the canvas state; unchanged results are ignored. */
  updateCanvas: (
    update: (canvas: CanvasState) => CanvasState,
    options?: CanvasUpdateOptions,
  ) => void;
  undo: () => void;
  redo: () => void;
  /** Adopts the content produced by "refresh from database". */
  applyRefreshedContent: (content: ProjectContent, settings: ConnectionSettings) => void;
  /** Runs `action` now, or after the user agrees to discard unsaved changes. */
  guardUnsavedChanges: (action: () => void) => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
  dismissFailure: () => void;
}

export function defaultCanvasState(): CanvasState {
  return { detailLevel: "keys", layout: "manual", viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] };
}

/** File name shown for a project: the file's base name, without the extension. */
export function projectDisplayName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const suffix = `.${PROJECT_FILE_EXTENSION}`;
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
}

function suggestedFileName(content: ProjectContent): string {
  const base = content.snapshot.databaseName.trim() || "schema";
  return `${base}.${PROJECT_FILE_EXTENSION}`;
}

function contentOf(file: Project): ProjectContent {
  return {
    connection: file.connection,
    inspection: file.inspection,
    snapshot: file.snapshot,
    canvas: file.canvas,
  };
}

function dialogTitle(key: "project.dialog.open" | "project.dialog.save"): string {
  return translate(useSettingsStore.getState().locale, key);
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  const writeTo = async (path: string): Promise<void> => {
    const { project } = get();
    if (project === null) {
      return;
    }
    set({ phase: "saving", failure: null });
    try {
      const backend = await getProjectBackend();
      const saved = await backend.writeProject(path, project.content);
      set((state) =>
        state.project === null
          ? { phase: "idle" }
          : {
              phase: "idle",
              project: {
                ...state.project,
                path,
                content: contentOf(saved),
                savedAt: saved.savedAt,
                isDirty: false,
              },
            },
      );
      void usePreferencesStore.getState().rememberProject(path);
    } catch (caught: unknown) {
      set({ phase: "idle", failure: { operation: "save", path, error: toOperationError(caught) } });
    }
  };

  const openUnguarded = async (path?: string): Promise<void> => {
    set({ phase: "opening", failure: null });
    let chosen = path ?? null;
    try {
      const backend = await getProjectBackend();
      chosen ??= await backend.pickProjectToOpen(dialogTitle("project.dialog.open"));
      if (chosen === null) {
        set({ phase: "idle" });
        return;
      }
      const file = await backend.readProject(chosen);
      const content = contentOf(file);
      set((state) => ({
        phase: "idle",
        history: EMPTY_HISTORY,
        project: {
          path: chosen,
          content: { ...content, canvas: ensurePlaced(content.canvas, content.snapshot) },
          liveSettings: null,
          savedAt: file.savedAt,
          isDirty: false,
          loadToken: (state.project?.loadToken ?? 0) + 1,
        },
      }));
      void usePreferencesStore.getState().rememberProject(chosen);
    } catch (caught: unknown) {
      const error = toOperationError(caught);
      set({ phase: "idle", failure: { operation: "open", path: chosen, error } });
      if (chosen !== null && error.kind.type === "project" && error.kind.value === "notFound") {
        void usePreferencesStore.getState().forgetProject(chosen);
      }
    }
  };

  return {
    project: null,
    phase: "idle",
    failure: null,
    pendingDiscard: null,
    history: EMPTY_HISTORY,

    loadFromInspection: (snapshot, settings, inspection) => {
      const previous = get().project;
      const canvas = ensurePlaced(
        {
          ...defaultCanvasState(),
          detailLevel: previous?.content.canvas.detailLevel ?? defaultCanvasState().detailLevel,
        },
        snapshot,
      );
      set({
        failure: null,
        history: EMPTY_HISTORY,
        project: {
          path: null,
          content: { connection: toSavedConnection(settings), inspection, snapshot, canvas },
          liveSettings: settings,
          savedAt: null,
          isDirty: false,
          loadToken: (previous?.loadToken ?? 0) + 1,
        },
      });
    },

    openProject: (path) => {
      if (get().phase !== "idle") {
        return;
      }
      get().guardUnsavedChanges(() => {
        void openUnguarded(path);
      });
    },

    saveProject: async () => {
      const { project, phase } = get();
      if (project === null || phase !== "idle") {
        return;
      }
      if (project.path === null) {
        await get().saveProjectAs();
        return;
      }
      await writeTo(project.path);
    },

    saveProjectAs: async () => {
      const { project, phase } = get();
      if (project === null || phase !== "idle") {
        return;
      }
      set({ failure: null });
      try {
        const backend = await getProjectBackend();
        const path = await backend.pickProjectToSave(
          dialogTitle("project.dialog.save"),
          project.path ?? suggestedFileName(project.content),
        );
        if (path !== null) {
          await writeTo(path);
        }
      } catch (caught: unknown) {
        set({ failure: { operation: "save", path: null, error: toOperationError(caught) } });
      }
    },

    setDetailLevel: (detailLevel) => {
      const { project } = get();
      if (project === null || project.content.canvas.detailLevel === detailLevel) {
        return;
      }
      // Taller nodes must not cover their neighbours; moving them apart is a real edit.
      const moved = spreadForDetailLevel(
        project.content.snapshot,
        project.content.canvas,
        detailLevel,
      );
      get().updateCanvas((canvas) => ({ ...withPositions(canvas, moved), detailLevel }), {
        undoable: moved.size > 0,
      });
    },

    updateCanvas: (update, options = {}) => {
      const { undoable = true, dirty = true } = options;
      set((state) => {
        if (state.project === null) {
          return {};
        }
        const current = state.project.content.canvas;
        const next = update(current);
        if (next === current) {
          return {};
        }
        return {
          project: {
            ...state.project,
            isDirty: state.project.isDirty || dirty,
            content: { ...state.project.content, canvas: next },
          },
          history: undoable
            ? { past: [...state.history.past.slice(-(HISTORY_LIMIT - 1)), current], future: [] }
            : state.history,
        };
      });
    },

    undo: () => {
      set((state) => {
        const previous = state.history.past.at(-1);
        if (previous === undefined || state.project === null) {
          return {};
        }
        return {
          project: {
            ...state.project,
            isDirty: true,
            content: { ...state.project.content, canvas: previous },
          },
          history: {
            past: state.history.past.slice(0, -1),
            future: [state.project.content.canvas, ...state.history.future],
          },
        };
      });
    },

    redo: () => {
      set((state) => {
        const next = state.history.future[0];
        if (next === undefined || state.project === null) {
          return {};
        }
        return {
          project: {
            ...state.project,
            isDirty: true,
            content: { ...state.project.content, canvas: next },
          },
          history: {
            past: [...state.history.past, state.project.content.canvas],
            future: state.history.future.slice(1),
          },
        };
      });
    },

    applyRefreshedContent: (content, settings) => {
      const placement = placeRefreshedEntities(content.canvas, content.snapshot);
      set((state) =>
        state.project === null
          ? {}
          : {
              history: EMPTY_HISTORY,
              project: {
                ...state.project,
                content: { ...content, canvas: ensurePlaced(placement.canvas, content.snapshot) },
                liveSettings: settings,
                isDirty: true,
                loadToken: state.project.loadToken + 1,
              },
            },
      );
      useCanvasUiStore.getState().highlightEntities(placement.placed);
    },

    guardUnsavedChanges: (action) => {
      if (get().project?.isDirty === true) {
        set({ pendingDiscard: action });
      } else {
        action();
      }
    },

    confirmDiscard: () => {
      const action = get().pendingDiscard;
      set({ pendingDiscard: null });
      action?.();
    },

    cancelDiscard: () => {
      set({ pendingDiscard: null });
    },

    dismissFailure: () => {
      set({ failure: null });
    },
  };
});
