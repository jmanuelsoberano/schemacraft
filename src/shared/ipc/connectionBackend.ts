import { Channel } from "@tauri-apps/api/core";

import type {
  ConnectionSettings,
  InspectionEvent,
  InspectionOptions,
  SchemaSnapshot,
  ServerInformation,
} from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError } from "./operationError";

/** Operations the connection feature needs from the Rust side. */
export interface ConnectionBackend {
  testConnection(settings: ConnectionSettings): Promise<ServerInformation>;
  listDatabases(settings: ConnectionSettings): Promise<string[]>;
  listSchemas(settings: ConnectionSettings): Promise<string[]>;
  inspectDatabase(
    settings: ConnectionSettings,
    options: InspectionOptions,
    onEvent: (event: InspectionEvent) => void,
  ): Promise<SchemaSnapshot>;
  cancelInspection(jobId: string): Promise<void>;
}

const tauriConnectionBackend: ConnectionBackend = {
  testConnection: (settings) => invokeCommand("test_connection", { settings }),
  listDatabases: (settings) => invokeCommand("list_databases", { settings }),
  listSchemas: (settings) => invokeCommand("list_schemas", { settings }),
  inspectDatabase: (settings, options, onEvent) => {
    const channel = new Channel<InspectionEvent>();
    channel.onmessage = onEvent;
    return invokeCommand("inspect_database", { settings, options, onEvent: channel });
  },
  cancelInspection: (jobId) => invokeCommand("cancel_inspection", { jobId }),
};

const unavailableConnectionBackend: ConnectionBackend = {
  testConnection: () => Promise.reject(ipcUnavailableError()),
  listDatabases: () => Promise.reject(ipcUnavailableError()),
  listSchemas: () => Promise.reject(ipcUnavailableError()),
  inspectDatabase: () => Promise.reject(ipcUnavailableError()),
  cancelInspection: () => Promise.reject(ipcUnavailableError()),
};

/** Resolves the connection backend for this window (see {@link createBackendResolver}). */
export const getConnectionBackend = createBackendResolver<ConnectionBackend>(
  tauriConnectionBackend,
  unavailableConnectionBackend,
  import.meta.env.DEV
    ? () => import("./previewConnectionBackend").then((module) => module.previewConnectionBackend)
    : null,
);
