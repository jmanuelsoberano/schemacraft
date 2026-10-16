import type { SavedConnection } from "@/shared/contracts";

import { createBackendResolver } from "./backendResolver";
import { invokeCommand } from "./invokeCommand";
import { ipcUnavailableError } from "./operationError";

/**
 * Remembered passwords. The Rust side keeps them in the operating system credential store; the
 * frontend only learns whether one exists and hands a password over once, when the user asks
 * to remember it.
 */
export interface CredentialsBackend {
  hasStoredPassword(connection: SavedConnection): Promise<boolean>;
  rememberPassword(connection: SavedConnection, password: string): Promise<void>;
  forgetPassword(connection: SavedConnection): Promise<boolean>;
}

const tauriCredentialsBackend: CredentialsBackend = {
  hasStoredPassword: (connection) => invokeCommand("has_stored_password", { connection }),
  rememberPassword: (connection, password) =>
    invokeCommand("remember_password", { connection, password }),
  forgetPassword: (connection) => invokeCommand("forget_password", { connection }),
};

const unavailableCredentialsBackend: CredentialsBackend = {
  hasStoredPassword: () => Promise.reject(ipcUnavailableError()),
  rememberPassword: () => Promise.reject(ipcUnavailableError()),
  forgetPassword: () => Promise.reject(ipcUnavailableError()),
};

/** Resolves the credentials backend for this window. */
export const getCredentialsBackend = createBackendResolver<CredentialsBackend>(
  tauriCredentialsBackend,
  unavailableCredentialsBackend,
  import.meta.env.DEV
    ? () => import("./previewCredentialsBackend").then((module) => module.previewCredentialsBackend)
    : null,
);
