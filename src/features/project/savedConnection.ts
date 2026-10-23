import type { ConnectionSettings, SavedConnection } from "@/shared/contracts";

/** The connection without its password, as projects and the history record it. */
export function toSavedConnection(
  settings: Extract<ConnectionSettings, { provider: "sqlServer" }>,
): Extract<SavedConnection, { provider: "sqlServer" }>;
export function toSavedConnection(
  settings: Extract<ConnectionSettings, { provider: "postgreSql" }>,
): Extract<SavedConnection, { provider: "postgreSql" }>;
export function toSavedConnection(settings: ConnectionSettings): SavedConnection;
export function toSavedConnection(settings: ConnectionSettings): SavedConnection {
  if (settings.provider === "postgreSql") {
    return {
      provider: "postgreSql",
      host: settings.host,
      port: settings.port,
      database: settings.database,
      username: settings.username,
      encryption: settings.encryption,
      rootCertificate: settings.rootCertificate,
    };
  }
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
