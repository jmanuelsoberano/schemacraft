import type {
  ConnectionSettings,
  InspectionOptions,
  PasswordSource,
  SavedConnection,
} from "@/shared/contracts";

import {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  emptyConnectionDraft,
} from "@/features/connection/connectionDraft";
import type { ConnectionDraft } from "@/features/connection/connectionDraft";
import { formatServerAddress } from "@/features/connection/serverAddress";

/** The connection without its password, as projects and the history record it. */
export function toSavedConnection(settings: ConnectionSettings): SavedConnection {
  return {
    provider: "sqlServer",
    host: settings.host,
    instance: settings.instance,
    port: settings.port,
    database: settings.database,
    authentication:
      settings.authentication.mode === "integrated"
        ? { mode: "integrated" }
        : { mode: "sqlLogin", username: settings.authentication.username },
    encryption: settings.encryption,
    trustServerCertificate: settings.trustServerCertificate,
  };
}

/** A dialog draft that reproduces a saved connection; the password is always empty. */
export function savedConnectionToDraft(
  saved: SavedConnection,
  inspection: InspectionOptions = { schemas: [], includeViews: true },
): ConnectionDraft {
  return {
    ...emptyConnectionDraft,
    server: formatServerAddress({ host: saved.host, instance: saved.instance, port: saved.port }),
    authenticationMode: saved.authentication.mode === "integrated" ? "integrated" : "sqlLogin",
    username: saved.authentication.mode === "sqlLogin" ? saved.authentication.username : "",
    password: "",
    database: saved.database,
    schemas: inspection.schemas,
    includeViews: inspection.includeViews,
    encryption: saved.encryption,
    trustServerCertificate: saved.trustServerCertificate,
  };
}

/** Pieces of a saved connection as the history and the status bar show them. */
export interface SavedConnectionDescription {
  /** Server as the user wrote it, e.g. `localhost\SQLEXPRESS`. */
  target: string;
  database: string | null;
  /** Login name, or `null` for Windows Authentication. */
  login: string | null;
}

export function describeSavedConnection(saved: SavedConnection): SavedConnectionDescription {
  return {
    target: formatServerAddress({ host: saved.host, instance: saved.instance, port: saved.port }),
    database: saved.database,
    login: saved.authentication.mode === "sqlLogin" ? saved.authentication.username : null,
  };
}

/** Stable identity of a saved connection, matching the history's notion of "same endpoint". */
export function savedConnectionKey(saved: SavedConnection): string {
  const { target, database, login } = describeSavedConnection(saved);
  return [target, database ?? "", login ?? "<windows>"].join("|").toLowerCase();
}

/** Live settings for a saved connection; `password` says where a SQL login's password comes from. */
export function savedConnectionToSettings(
  saved: SavedConnection,
  password: PasswordSource,
): ConnectionSettings {
  return {
    provider: "sqlServer",
    host: saved.host,
    instance: saved.instance,
    port: saved.port,
    database: saved.database,
    authentication:
      saved.authentication.mode === "integrated"
        ? { mode: "integrated" }
        : { mode: "sqlLogin", username: saved.authentication.username, password },
    encryption: saved.encryption,
    trustServerCertificate: saved.trustServerCertificate,
    connectTimeoutSeconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
  };
}
