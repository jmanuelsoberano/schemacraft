/** Parsed form of the single "Server" field, which accepts the same notations as SSMS. */
export interface ServerAddress {
  host: string;
  /** Named instance, resolved through SQL Browser. */
  instance: string | null;
  /** Explicit TCP port; `null` means the default port or the instance's port. */
  port: number | null;
}

export type ServerAddressParse =
  { ok: true; address: ServerAddress } | { ok: false; reason: "empty" | "invalidPort" };

const LOCAL_ALIASES = new Set([".", "(local)", "localhost"]);

/**
 * Parses `host`, `host\instance`, `host,port` or `host\instance,port`, with an optional `tcp:`
 * prefix. `.` and `(local)` mean the local machine.
 */
export function parseServerAddress(input: string): ServerAddressParse {
  let text = input.trim();
  if (text === "") {
    return { ok: false, reason: "empty" };
  }
  if (text.toLowerCase().startsWith("tcp:")) {
    text = text.slice("tcp:".length).trim();
  }

  let port: number | null = null;
  const commaIndex = text.lastIndexOf(",");
  if (commaIndex >= 0) {
    const portText = text.slice(commaIndex + 1).trim();
    text = text.slice(0, commaIndex).trim();
    if (!/^\d{1,5}$/.test(portText)) {
      return { ok: false, reason: "invalidPort" };
    }
    port = Number.parseInt(portText, 10);
    if (port < 1 || port > 65535) {
      return { ok: false, reason: "invalidPort" };
    }
  }

  let instance: string | null = null;
  const backslashIndex = text.indexOf("\\");
  if (backslashIndex >= 0) {
    const instanceText = text.slice(backslashIndex + 1).trim();
    instance = instanceText === "" ? null : instanceText;
    text = text.slice(0, backslashIndex).trim();
  }

  if (text === "") {
    return { ok: false, reason: "empty" };
  }
  const host = LOCAL_ALIASES.has(text.toLowerCase()) ? "localhost" : text;
  return { ok: true, address: { host, instance, port } };
}

/** The address as users write it, e.g. `localhost\SQLEXPRESS` or `db.example.com,1433`. */
export function formatServerAddress(address: ServerAddress): string {
  const instancePart = address.instance === null ? "" : `\\${address.instance}`;
  const portPart = address.port === null ? "" : `,${address.port}`;
  return `${address.host}${instancePart}${portPart}`;
}
