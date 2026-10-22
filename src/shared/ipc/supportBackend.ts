import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { DiagnosticReport, SupportPage } from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError } from "./operationError";

/** Local diagnostics and explicit browser opening; no report submission or upload. */
export interface SupportBackend {
  readReport(): Promise<DiagnosticReport>;
  pickDestination(
    title: string,
    suggestedFileName: string,
    fileType: string,
  ): Promise<string | null>;
  writeReport(path: string, text: string): Promise<void>;
  openPage(page: SupportPage): Promise<void>;
  revealInFolder(path: string): Promise<void>;
}

const tauriSupportBackend: SupportBackend = {
  readReport: () => invokeCommand("read_diagnostic_report"),
  pickDestination: (title, suggestedFileName, fileType) =>
    save({
      title,
      defaultPath: suggestedFileName,
      filters: [{ name: fileType, extensions: ["txt"] }],
    }),
  writeReport: (path, text) => invokeCommand("write_diagnostic_report", { path, text }),
  openPage: (page) => invokeCommand("open_support_page", { page }),
  revealInFolder: (path) => revealItemInDir(path),
};

const unavailableSupportBackend: SupportBackend = {
  readReport: () => Promise.reject(ipcUnavailableError()),
  pickDestination: () => Promise.reject(ipcUnavailableError()),
  writeReport: () => Promise.reject(ipcUnavailableError()),
  openPage: () => Promise.reject(ipcUnavailableError()),
  revealInFolder: () => Promise.reject(ipcUnavailableError()),
};

// A browser preview must not fabricate a diagnostic file or open a support page as the host.
export const getSupportBackend = createBackendResolver<SupportBackend>(
  tauriSupportBackend,
  unavailableSupportBackend,
  null,
);
