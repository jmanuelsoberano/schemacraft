import { Channel } from "@tauri-apps/api/core";

import type {
  ProjectComparison,
  SchemaSnapshot,
  SourceDiffOptions,
  SourceLineDiff,
} from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError } from "./operationError";

/** Immutable comparison and cancellable source pages; no connection or project-store writes. */
export interface ComparisonBackend {
  compare(reference: SchemaSnapshot, compared: SchemaSnapshot): Promise<ProjectComparison>;
  compareSource(
    reference: string,
    compared: string,
    options: SourceDiffOptions,
    onStarted: (id: string) => void,
  ): Promise<SourceLineDiff>;
  cancel(jobId: string): Promise<void>;
}

const tauriComparisonBackend: ComparisonBackend = {
  compare: (reference, compared) =>
    invokeCommand("compare_project_snapshots", { reference, compared }),
  compareSource: (reference, compared, options, onStarted) => {
    const channel = new Channel<string>();
    channel.onmessage = onStarted;
    return invokeCommand("compare_project_source", {
      reference,
      compared,
      options,
      onStarted: channel,
    });
  },
  cancel: (jobId) => invokeCommand("cancel_project_comparison", { jobId }),
};

export const unavailableComparisonBackend: ComparisonBackend = {
  compare: () => Promise.reject(ipcUnavailableError()),
  compareSource: () => Promise.reject(ipcUnavailableError()),
  cancel: () => Promise.reject(ipcUnavailableError()),
};

/** The real core owns comparison semantics; a browser preview never fabricates an answer. */
export const getComparisonBackend = createBackendResolver<ComparisonBackend>(
  tauriComparisonBackend,
  unavailableComparisonBackend,
  import.meta.env.DEV
    ? () => import("./previewComparisonBackend").then((module) => module.previewComparisonBackend)
    : null,
);
