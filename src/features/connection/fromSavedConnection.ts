// A saved connection turned back into what the connection feature works with: a dialog draft,
// live settings, the description the history shows and the key that identifies an endpoint.
import type {
  ConnectionSettings,
  InspectionOptions,
  PasswordSource,
  SavedConnection,
} from "@/shared/contracts";

import {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  draftToInspectionOptions,
  emptyConnectionDraft,
} from "./connectionDraft";
import type { ConnectionDraft } from "./connectionDraft";
import { formatServerAddress } from "./serverAddress";
import { formatPostgreSqlAddress } from "./postgreSqlAddress";
import {
  savedConnectionIdentity,
  savedConnectionTarget,
} from "@/shared/connections/savedConnectionIdentity";

/** A dialog draft that reproduces a saved connection; the password is always empty. */
export function savedConnectionToDraft(
  saved: SavedConnection,
  inspection: InspectionOptions = draftToInspectionOptions(emptyConnectionDraft),
): ConnectionDraft {
  if (saved.provider === "postgreSql") {
    return {
      ...emptyConnectionDraft,
      provider: "postgreSql",
      server: formatPostgreSqlAddress(saved),
      username: saved.username,
      database: saved.database,
      authenticationMode: "sqlLogin",
      postgreSqlEncryption: saved.encryption,
      rootCertificate: saved.rootCertificate ?? "",
      schemas: inspection.schemas,
      includeViews: inspection.includeViews,
      includeProgrammability: inspection.includeProgrammability,
      includeModuleDefinitions: inspection.includeModuleDefinitions,
      includeDependencies: inspection.includeDependencies ?? true,
    };
  }
  return {
    ...emptyConnectionDraft,
    server: formatServerAddress({ host: saved.host, instance: saved.instance, port: saved.port }),
    authenticationMode: saved.authentication.mode === "integrated" ? "integrated" : "sqlLogin",
    username: saved.authentication.mode === "sqlLogin" ? saved.authentication.username : "",
    password: "",
    database: saved.database,
    schemas: inspection.schemas,
    includeViews: inspection.includeViews,
    includeProgrammability: inspection.includeProgrammability,
    includeModuleDefinitions: inspection.includeModuleDefinitions,
    includeDependencies: inspection.includeDependencies ?? true,
    encryption: saved.encryption,
    trustServerCertificate: saved.trustServerCertificate,
  };
}

/** Pieces of a saved connection as the history and the status bar show them. */
export interface SavedConnectionDescription {
  /** Canonical server name, e.g. `localhost\SQLEXPRESS` or `db.example.com,1433`. */
  target: string;
  database: string | null;
  /** Login name, or `null` for Windows Authentication. */
  login: string | null;
}

export function describeSavedConnection(saved: SavedConnection): SavedConnectionDescription {
  if (saved.provider === "postgreSql")
    return {
      target: savedConnectionTarget(saved),
      database: saved.database,
      login: saved.username,
    };
  return {
    target: savedConnectionTarget(saved),
    database: saved.database,
    login: saved.authentication.mode === "sqlLogin" ? saved.authentication.username : null,
  };
}

/** Stable identity of a saved connection, matching the history's notion of "same endpoint". */
export function savedConnectionKey(saved: SavedConnection): string {
  return savedConnectionIdentity(saved);
}

/** Live settings for a saved connection; `password` says where a SQL login's password comes from. */
export function savedConnectionToSettings(
  saved: SavedConnection,
  password: PasswordSource,
): ConnectionSettings {
  if (saved.provider === "postgreSql")
    return {
      ...saved,
      password,
      connectTimeoutSeconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
    };
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
