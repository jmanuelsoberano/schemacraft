import { describe, expect, it } from "vitest";

import type { AccessProfile, SavedConnection, SchemaSnapshot } from "@/shared/contracts";

import { noticeSignature, showsAccessBar, showsAccessChip } from "./accessNotice";
import { personas } from "./testFixtures";

const connection: SavedConnection = {
  provider: "sqlServer",
  host: "DB.example.com",
  instance: null,
  port: null,
  database: "Shop",
  authentication: { mode: "sqlLogin", username: "reporting" },
  encryption: "mandatory",
  trustServerCertificate: false,
};

function snapshot(access?: AccessProfile): SchemaSnapshot {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt: "2026-10-15T09:00:00Z",
    ...(access === undefined ? {} : { access }),
    tables: [],
    views: [],
    foreignKeys: [],
  };
}

describe("showsAccessChip", () => {
  it("marks partial captures only", () => {
    expect(showsAccessChip(snapshot(personas.reader))).toBe(true);
    expect(showsAccessChip(snapshot(personas.owner))).toBe(false);
    expect(showsAccessChip(snapshot(personas.emptyDatabase))).toBe(false);
    // A SchemaCraft 1.0 file recorded nothing, so it does not nag.
    expect(showsAccessChip(snapshot())).toBe(false);
  });
});

describe("noticeSignature", () => {
  it("names the endpoint the way the server identifies it", () => {
    const signature = noticeSignature(connection, snapshot(personas.reader));
    expect(signature).toBe(
      noticeSignature(
        { ...connection, host: " db.example.com", port: 1433 },
        snapshot(personas.reader),
      ),
    );
    expect(signature).not.toBe(
      noticeSignature({ ...connection, port: 14333 }, snapshot(personas.reader)),
    );
    expect(signature).not.toBe(
      noticeSignature({ ...connection, database: "Other" }, snapshot(personas.reader)),
    );
    // A named instance is found through SQL Browser; its port does not identify it.
    const instance = { ...connection, instance: "SQLEXPRESS" };
    expect(noticeSignature(instance, snapshot(personas.reader))).toBe(
      noticeSignature({ ...instance, port: 50123 }, snapshot(personas.reader)),
    );
  });

  it("changes with the verdicts, so a different capture brings the notice back", () => {
    const reader = noticeSignature(connection, snapshot(personas.reader));
    expect(reader).not.toBe(noticeSignature(connection, snapshot(personas.salesViewDefinition)));
    expect(reader).not.toBe(noticeSignature(connection, snapshot(personas.twoTables)));
  });

  it("does not exist without a recorded profile", () => {
    expect(noticeSignature(connection, snapshot())).toBeNull();
  });
});

describe("showsAccessBar", () => {
  it("stays closed once the user dismissed this situation", () => {
    const partial = snapshot(personas.reader);
    expect(showsAccessBar(connection, partial, [])).toBe(true);
    const signature = noticeSignature(connection, partial) ?? "";
    expect(showsAccessBar(connection, partial, [signature])).toBe(false);
    expect(showsAccessBar(connection, snapshot(personas.twoTables), [signature])).toBe(true);
  });

  it("never shows for full, empty or unrecorded access", () => {
    expect(showsAccessBar(connection, snapshot(personas.owner), [])).toBe(false);
    expect(showsAccessBar(connection, snapshot(personas.emptyDatabase), [])).toBe(false);
    expect(showsAccessBar(connection, snapshot(), [])).toBe(false);
  });
});
