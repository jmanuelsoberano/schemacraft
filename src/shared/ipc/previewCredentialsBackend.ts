/**
 * Simulated credential store for development in a plain browser: remembered passwords live in
 * memory for the lifetime of the page. Loaded only in development builds outside the desktop
 * runtime.
 */
import type { SavedConnection } from "@/shared/contracts";
import { savedCredentialIdentity } from "@/shared/connections/savedConnectionIdentity";

import type { CredentialsBackend } from "./credentialsBackend";

const remembered = new Map<string, string>();

function keyOf(connection: SavedConnection): string | null {
  return savedCredentialIdentity(connection);
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
