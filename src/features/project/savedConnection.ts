import type { ConnectionSettings, SavedConnection } from "@/shared/contracts";

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
