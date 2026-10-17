import { open, save } from "@tauri-apps/plugin-dialog";

import type {
  OpenedProject,
  Project,
  ProjectContent,
  SchemaDiff,
  SchemaSnapshot,
} from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError } from "./operationError";

/** File extension of project files, without the dot. */
export const PROJECT_FILE_EXTENSION = "scraft";

/** Operations the project feature needs from the Rust side and the native file dialogs. */
export interface ProjectBackend {
  /** Lets the user choose a project file; `null` when the dialog is cancelled. */
  pickProjectToOpen(labels: FileDialogLabels): Promise<string | null>;
  /** Lets the user choose where to save; `null` when the dialog is cancelled. */
  pickProjectToSave(labels: FileDialogLabels, suggestedFileName: string): Promise<string | null>;
  /**
   * Reads a project file, upgraded to the current format when it is older. A file of a newer
   * format that allows older readers comes back read-only.
   */
  readProject(path: string): Promise<OpenedProject>;
  writeProject(path: string, content: ProjectContent): Promise<Project>;
  computeSchemaDiff(previous: SchemaSnapshot, current: SchemaSnapshot): Promise<SchemaDiff>;
  refreshProjectContent(content: ProjectContent, snapshot: SchemaSnapshot): Promise<ProjectContent>;
}

/** Text of a native file dialog, in the user's language. */
export interface FileDialogLabels {
  title: string;
  /** Name of the file type in the type filter, e.g. "SchemaCraft project". */
  fileTypeName: string;
}

const projectFilter = (labels: FileDialogLabels) => ({
  name: labels.fileTypeName,
  extensions: [PROJECT_FILE_EXTENSION],
});

const tauriProjectBackend: ProjectBackend = {
  pickProjectToOpen: (labels) =>
    open({
      title: labels.title,
      multiple: false,
      directory: false,
      filters: [projectFilter(labels)],
    }),
  pickProjectToSave: (labels, suggestedFileName) =>
    save({ title: labels.title, defaultPath: suggestedFileName, filters: [projectFilter(labels)] }),
  readProject: (path) => invokeCommand("read_project", { path }),
  writeProject: (path, content) => invokeCommand("write_project", { path, content }),
  computeSchemaDiff: (previous, current) =>
    invokeCommand("compute_schema_diff", { previous, current }),
  refreshProjectContent: (content, snapshot) =>
    invokeCommand("refresh_project_content", { content, snapshot }),
};

const unavailableProjectBackend: ProjectBackend = {
  pickProjectToOpen: () => Promise.reject(ipcUnavailableError()),
  pickProjectToSave: () => Promise.reject(ipcUnavailableError()),
  readProject: () => Promise.reject(ipcUnavailableError()),
  writeProject: () => Promise.reject(ipcUnavailableError()),
  computeSchemaDiff: () => Promise.reject(ipcUnavailableError()),
  refreshProjectContent: () => Promise.reject(ipcUnavailableError()),
};

/** Resolves the project backend for this window. */
export const getProjectBackend = createBackendResolver<ProjectBackend>(
  tauriProjectBackend,
  unavailableProjectBackend,
  import.meta.env.DEV
    ? () => import("./previewProjectBackend").then((module) => module.previewProjectBackend)
    : null,
);
