// When the partial-access notices appear. Full access shows nothing, partial access shows a chip
// in the status bar and a dismissible bar over the entities, and a snapshot that recorded no
// access (SchemaCraft 1.0) shows neither, so old files do not nag.
import type { SavedConnection, SchemaSnapshot } from "@/shared/contracts";

/** Port SQL Server listens on when the connection names neither a port nor an instance. */
const DEFAULT_PORT = 1433;

/**
 * Identity of the notice a capture raises: the endpoint, the database and the verdicts. Closing
 * the bar records it, so the bar stays closed for the same situation and comes back when a
 * later capture of that database reaches another verdict. `null` when nothing was recorded.
 */
export function noticeSignature(
  connection: SavedConnection,
  snapshot: SchemaSnapshot,
): string | null {
  const { access } = snapshot;
  if (access === undefined) {
    return null;
  }
  if (connection.provider === "postgreSql")
    return JSON.stringify([
      connection.provider,
      connection.host.trim().toLowerCase(),
      connection.port ?? 5432,
      connection.database ?? snapshot.databaseName,
      access.level,
      access.coverage.objects,
      access.coverage.definitions,
    ]);
  const instance = connection.instance?.trim().toLowerCase() ?? "";
  return JSON.stringify([
    connection.host.trim().toLowerCase(),
    instance,
    // A named instance is found through SQL Browser, so its port does not identify it.
    instance === "" ? (connection.port ?? DEFAULT_PORT) : null,
    (connection.database ?? snapshot.databaseName).toLowerCase(),
    access.level,
    access.coverage.objects,
    access.coverage.definitions,
  ]);
}

/** Whether the status bar shows the partial-access chip. */
export function showsAccessChip(snapshot: SchemaSnapshot): boolean {
  return snapshot.access?.level === "partial";
}

/** Whether the entities panel shows the partial-access bar, unless the user closed it. */
export function showsAccessBar(
  connection: SavedConnection,
  snapshot: SchemaSnapshot,
  dismissed: readonly string[],
): boolean {
  const signature = noticeSignature(connection, snapshot);
  return showsAccessChip(snapshot) && signature !== null && !dismissed.includes(signature);
}
