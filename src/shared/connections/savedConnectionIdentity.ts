import type { SavedConnection } from "@/shared/contracts";

/** Canonical endpoint shared by history, credential preview and connection presentation. */
export function savedConnectionTarget(connection: SavedConnection): string {
  const host = connection.host.trim();
  if (connection.provider === "postgreSql") {
    const address = host.replace(/^\[|\]$/gu, "");
    return `${address.includes(":") ? `[${address}]` : address}:${connection.port ?? 5432}`;
  }
  const instance = connection.instance?.trim() ?? "";
  return instance === "" ? `${host},${connection.port ?? 1433}` : `${host}\\${instance}`;
}

function folded(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "" ? null : normalized;
}

/** Matches Rust's provider-specific same_endpoint_as, preserving PostgreSQL role/database case. */
export function savedConnectionIdentity(connection: SavedConnection): string {
  const target = savedConnectionTarget(connection).toLowerCase();
  return JSON.stringify(
    connection.provider === "postgreSql"
      ? [connection.provider, target, connection.database, connection.username]
      : [
          connection.provider,
          target,
          folded(connection.database),
          connection.authentication.mode,
          connection.authentication.mode === "sqlLogin"
            ? folded(connection.authentication.username)
            : null,
        ],
  );
}

/** Same secret namespace as the native store; database is deliberately not part of a login. */
export function savedCredentialIdentity(connection: SavedConnection): string | null {
  const target = savedConnectionTarget(connection).toLowerCase();
  if (connection.provider === "postgreSql") return `postgresql://${target}/${connection.username}`;
  return connection.authentication.mode === "integrated"
    ? null
    : `sqlserver://${target}/${connection.authentication.username.trim()}`;
}
