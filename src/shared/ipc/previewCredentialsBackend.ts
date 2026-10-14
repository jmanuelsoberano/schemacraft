/**
 * Simulated credential store for development in a plain browser: remembered passwords live in
 * memory for the lifetime of the page. Loaded only in development builds outside the desktop
 * runtime.
 */
import type { SavedConnection } from "@/shared/contracts";

import type { CredentialsBackend } from "./credentialsBackend";

const remembered = new Map<string, string>();

function keyOf(connection: SavedConnection): string | null {
  if (connection.authentication.mode !== "sqlLogin") {
    return null;
  }
  const target = connection.instance
    ? `${connection.host}\\${connection.instance}`
    : `${connection.host},${connection.port ?? 1433}`;
  return `${target.toLowerCase()}/${connection.authentication.username}`;
}

export const previewCredentialsBackend: CredentialsBackend = {
  hasStoredPassword(connection) {
    const key = keyOf(connection);
    return Promise.resolve(key !== null && remembered.has(key));
  },

  rememberPassword(connection, password) {
    const key = keyOf(connection);
    if (key !== null) {
      remembered.set(key, password);
    }
    return Promise.resolve();
  },

  forgetPassword(connection) {
    const key = keyOf(connection);
    return Promise.resolve(key !== null && remembered.delete(key));
  },
};
