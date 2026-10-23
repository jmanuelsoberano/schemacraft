import { describe, expect, it } from "vitest";

import {
  formatPostgreSqlTarget,
  isLocalPostgreSqlHost,
  parsePostgreSqlAddress,
} from "./postgreSqlAddress";

describe("PostgreSQL endpoints", () => {
  it.each([
    ["db.example.test", "db.example.test", null, "db.example.test:5432"],
    [" localhost:15432 ", "localhost", 15432, "localhost:15432"],
    ["[::1]:15432", "::1", 15432, "[::1]:15432"],
    ["::1", "::1", null, "[::1]:5432"],
  ])("parses %s without guessing a SQL Server address", (input, host, port, target) => {
    const parsed = parsePostgreSqlAddress(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("valid address expected");
    expect(parsed.address).toEqual({ host, port });
    expect(formatPostgreSqlTarget(parsed.address)).toBe(target);
  });

  it.each([
    "db\\instance",
    "db,5432",
    "postgresql://user:secret@db/app",
    "user@db",
    "db/path",
    "[::1]:0",
    "db:65536",
    "db:",
    "[not-ip]:5432",
    "db#fragment",
  ])("rejects %s", (input) => {
    expect(parsePostgreSqlAddress(input).ok).toBe(false);
  });

  it("limits unsafe transport exceptions to literal loopback or localhost", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "0:0:0:0:0:0:0:1",
    ])
      expect(isLocalPostgreSqlHost(host)).toBe(true);
    for (const host of [
      "db.example.test",
      "192.0.2.1",
      "localhost.example.test",
      "127.999.0.1",
      "127.00.0.1",
      "::ffff:127.0.0.1",
    ])
      expect(isLocalPostgreSqlHost(host)).toBe(false);
  });
});
