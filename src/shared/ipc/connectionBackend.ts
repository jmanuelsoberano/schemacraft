import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

import type {
  ConnectionSettings,
  InspectionEvent,
  InspectionOptions,
  SchemaSnapshot,
  ServerInformation,
} from "@/shared/contracts";

import { ipcUnavailableError, toOperationError } from "./operationError";

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

async function invokeCommand<T>(command: string, arguments_: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, arguments_);
  } catch (error: unknown) {
    throw toOperationError(error);
  }
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

let backendPromise: Promise<ConnectionBackend> | undefined;

/**
 * Resolves the backend for this window: the Tauri commands inside the desktop application, a
 * simulated backend in a development browser preview, and a backend that reports the runtime
 * as unavailable anywhere else.
 */
export function getConnectionBackend(): Promise<ConnectionBackend> {
  backendPromise ??= resolveBackend();
  return backendPromise;
}

function resolveBackend(): Promise<ConnectionBackend> {
  if (isTauri()) {
    return Promise.resolve(tauriConnectionBackend);
  }
  if (import.meta.env.DEV) {
    return import("./previewConnectionBackend").then((module) => module.previewConnectionBackend);
  }
  return Promise.resolve(unavailableConnectionBackend);
}
