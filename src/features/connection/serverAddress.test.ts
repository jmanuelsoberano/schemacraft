import { describe, expect, it } from "vitest";

import { formatServerAddress, parseServerAddress } from "./serverAddress";

describe("parseServerAddress", () => {
  it("accepts a bare host", () => {
    expect(parseServerAddress(" db.example.com ")).toEqual({
      ok: true,
      address: { host: "db.example.com", instance: null, port: null },
    });
  });

  it("accepts a named instance", () => {
    expect(parseServerAddress("localhost\\SQLEXPRESS")).toEqual({
      ok: true,
      address: { host: "localhost", instance: "SQLEXPRESS", port: null },
    });
  });

  it("accepts an explicit port and a tcp prefix", () => {
    expect(parseServerAddress("tcp:192.168.1.50,1433")).toEqual({
      ok: true,
      address: { host: "192.168.1.50", instance: null, port: 1433 },
    });
  });

  it("maps local aliases to localhost", () => {
    expect(parseServerAddress(".")).toMatchObject({ ok: true, address: { host: "localhost" } });
    expect(parseServerAddress("(local)\\DEV")).toMatchObject({
      ok: true,
      address: { host: "localhost", instance: "DEV" },
    });
  });

  it("rejects empty input and bad ports", () => {
    expect(parseServerAddress("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseServerAddress("\\SQLEXPRESS")).toEqual({ ok: false, reason: "empty" });
    expect(parseServerAddress("host,abc")).toEqual({ ok: false, reason: "invalidPort" });
    expect(parseServerAddress("host,70000")).toEqual({ ok: false, reason: "invalidPort" });
    expect(parseServerAddress("host,0")).toEqual({ ok: false, reason: "invalidPort" });
  });
});

describe("formatServerAddress", () => {
  it("round-trips the common notations", () => {
    for (const input of ["localhost", "localhost\\SQLEXPRESS", "db.example.com,14333"]) {
      const parsed = parseServerAddress(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(formatServerAddress(parsed.address)).toBe(input);
      }
    }
  });
});
