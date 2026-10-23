/** PostgreSQL TCP endpoints, never SQL Server instance syntax or credential-bearing URIs. */
export interface PostgreSqlAddress {
  host: string;
  port: number | null;
}

export type PostgreSqlAddressResult =
  | { ok: true; address: PostgreSqlAddress }
  | { ok: false; reason: "empty" | "invalidPort" | "invalidAddress" };

function validIpv6(host: string): boolean {
  try {
    return new URL(`https://[${host}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}

export function parsePostgreSqlAddress(input: string): PostgreSqlAddressResult {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "empty" };
  if (/[\s\\/,@?#\0]/u.test(text)) return { ok: false, reason: "invalidAddress" };
  let host = text;
  let portText: string | null = null;
  if (text.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(.*))?$/u.exec(text);
    if (match?.[1] === undefined || !validIpv6(match[1]))
      return { ok: false, reason: "invalidAddress" };
    host = match[1];
    portText = match[2] ?? null;
  } else {
    const colons = text.match(/:/gu)?.length ?? 0;
    if (colons > 1) {
      if (!validIpv6(text)) return { ok: false, reason: "invalidAddress" };
    } else if (colons === 1) {
      const separator = text.indexOf(":");
      host = text.slice(0, separator);
      portText = text.slice(separator + 1);
    }
  }
  if (host === "" || /[[\]]/u.test(host)) return { ok: false, reason: "invalidAddress" };
  let port: number | null = null;
  if (portText !== null) {
    if (!/^\d{1,5}$/u.test(portText)) return { ok: false, reason: "invalidPort" };
    port = Number(portText);
    if (port < 1 || port > 65535) return { ok: false, reason: "invalidPort" };
  }
  return { ok: true, address: { host, port } };
}

export function formatPostgreSqlTarget(address: PostgreSqlAddress): string {
  const host = address.host.trim().replace(/^\[|\]$/gu, "");
  return `${host.includes(":") ? `[${host}]` : host}:${address.port ?? 5432}`;
}

export function formatPostgreSqlAddress(address: PostgreSqlAddress): string {
  const raw = address.host.trim().replace(/^\[|\]$/gu, "");
  const host = raw.includes(":") ? `[${raw}]` : raw;
  return address.port === null ? host : `${host}:${address.port}`;
}

/** Matches the backend's explicit local-development policy, without DNS guessing. */
export function isLocalPostgreSqlHost(host: string): boolean {
  if (host.toLowerCase() === "localhost") return true;
  if (host.includes(":")) {
    try {
      return new URL(`https://[${host}]/`).hostname === "[::1]";
    } catch {
      return false;
    }
  }
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255)
  );
}
