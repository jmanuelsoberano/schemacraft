import { Channel } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { ExportEvent, ExportOutcome, ExportRequest } from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError, toOperationError } from "./operationError";

/** A file type offered by the save dialog. */
export interface ExportFileType {
  /** Human name of the type, e.g. "SVG image". */
  name: string;
  /** Extension without the dot. */
  extension: string;
}

/** Operations the export feature needs from the Rust side and the native dialogs. */
export interface ExportBackend {
  /** Lets the user choose where to write; `null` when the dialog is cancelled. */
  pickDestination(
    title: string,
    suggestedFileName: string,
    fileType: ExportFileType,
  ): Promise<string | null>;
  exportDiagram(
    request: ExportRequest,
    onEvent: (event: ExportEvent) => void,
  ): Promise<ExportOutcome>;
  cancelExport(jobId: string): Promise<void>;
  /** Shows the written file in the system file manager. */
  revealInFolder(path: string): Promise<void>;
}

const tauriExportBackend: ExportBackend = {
  pickDestination: (title, suggestedFileName, fileType) =>
    save({
      title,
      defaultPath: suggestedFileName,
      filters: [{ name: fileType.name, extensions: [fileType.extension] }],
    }),
  exportDiagram: (request, onEvent) => {
    const channel = new Channel<ExportEvent>();
    channel.onmessage = onEvent;
    return invokeCommand("export_diagram", { request, onEvent: channel });
  },
  cancelExport: (jobId) => invokeCommand("cancel_export", { jobId }),
  revealInFolder: async (path) => {
    try {
      await revealItemInDir(path);
    } catch (error: unknown) {
      throw toOperationError(error);
    }
  },
};

const unavailableExportBackend: ExportBackend = {
  pickDestination: () => Promise.reject(ipcUnavailableError()),
  exportDiagram: () => Promise.reject(ipcUnavailableError()),
  cancelExport: () => Promise.reject(ipcUnavailableError()),
  revealInFolder: () => Promise.reject(ipcUnavailableError()),
};

/** Resolves the export backend for this window. */
export const getExportBackend = createBackendResolver<ExportBackend>(
  tauriExportBackend,
  unavailableExportBackend,
  import.meta.env.DEV
    ? () => import("./previewExportBackend").then((module) => module.previewExportBackend)
    : null,
);
