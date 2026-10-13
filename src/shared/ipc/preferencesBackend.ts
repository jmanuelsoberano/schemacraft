import { invoke } from "@tauri-apps/api/core";

import type { Preferences, SavedConnection } from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { ipcUnavailableError, toOperationError } from "./operationError";

/** Connection history and recent projects, kept by the Rust side in the user's profile. */
export interface PreferencesBackend {
  readPreferences(): Promise<Preferences>;
  rememberConnection(connection: SavedConnection): Promise<Preferences>;
  forgetConnection(connection: SavedConnection): Promise<Preferences>;
  rememberProject(path: string): Promise<Preferences>;
  forgetProject(path: string): Promise<Preferences>;
}

async function invokeCommand<T>(command: string, arguments_: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, arguments_);
  } catch (error: unknown) {
    throw toOperationError(error);
  }
}

const tauriPreferencesBackend: PreferencesBackend = {
  readPreferences: () => invokeCommand("read_preferences", {}),
  rememberConnection: (connection) => invokeCommand("remember_connection", { connection }),
  forgetConnection: (connection) => invokeCommand("forget_connection", { connection }),
  rememberProject: (path) => invokeCommand("remember_project", { path }),
  forgetProject: (path) => invokeCommand("forget_project", { path }),
};

const unavailablePreferencesBackend: PreferencesBackend = {
  readPreferences: () => Promise.reject(ipcUnavailableError()),
  rememberConnection: () => Promise.reject(ipcUnavailableError()),
  forgetConnection: () => Promise.reject(ipcUnavailableError()),
  rememberProject: () => Promise.reject(ipcUnavailableError()),
  forgetProject: () => Promise.reject(ipcUnavailableError()),
};

/** Resolves the preferences backend for this window. */
export const getPreferencesBackend = createBackendResolver<PreferencesBackend>(
  tauriPreferencesBackend,
  unavailablePreferencesBackend,
  import.meta.env.DEV
    ? () => import("./previewPreferencesBackend").then((module) => module.previewPreferencesBackend)
    : null,
);
