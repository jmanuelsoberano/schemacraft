import { describe, expect, it } from "vitest";

import type { SavedConnection } from "@/shared/contracts";

import {
  describeSavedConnection,
  savedConnectionKey,
  savedConnectionToDraft,
} from "./fromSavedConnection";

describe("savedConnectionToDraft", () => {
  const saved: SavedConnection = {
    provider: "sqlServer",
    host: "localhost",
    instance: "SQLEXPRESS",
    port: null,
    database: "Shop",
    authentication: { mode: "sqlLogin", username: "app" },
    encryption: "optional",
    trustServerCertificate: true,
  };

  it("reproduces the connection with an empty password and the given inspection options", () => {
    const draft = savedConnectionToDraft(saved, {
      schemas: ["sales"],
      includeViews: false,
      includeProgrammability: true,
      includeModuleDefinitions: false,
    });
    expect(draft).toMatchObject({
      server: "localhost\\SQLEXPRESS",
      authenticationMode: "sqlLogin",
      username: "app",
      password: "",
      database: "Shop",
      schemas: ["sales"],
      includeViews: false,
      includeProgrammability: true,
      includeModuleDefinitions: false,
      encryption: "optional",
      trustServerCertificate: true,
    });
  });

  it("defaults to every schema, views included and code read and saved", () => {
    const draft = savedConnectionToDraft({ ...saved, authentication: { mode: "integrated" } });
    expect(draft.authenticationMode).toBe("integrated");
    expect(draft.username).toBe("");
    expect(draft.schemas).toEqual([]);
    expect(draft.includeViews).toBe(true);
    expect(draft.includeProgrammability).toBe(true);
    expect(draft.includeModuleDefinitions).toBe(true);
  });

  it("describes and keys connections by endpoint", () => {
    expect(describeSavedConnection(saved)).toEqual({
      target: "localhost\\SQLEXPRESS",
      database: "Shop",
      login: "app",
    });
    expect(JSON.parse(savedConnectionKey(saved))).toEqual([
      "sqlServer",
      "localhost\\sqlexpress",
      "shop",
      "sqlLogin",
      "app",
    ]);
    expect(savedConnectionKey({ ...saved, authentication: { mode: "integrated" } })).toBe(
      JSON.stringify(["sqlServer", "localhost\\sqlexpress", "shop", "integrated", null]),
    );
  });

  it("names a server without an instance by host and port, defaulting to 1433", () => {
    const tcp: SavedConnection = { ...saved, host: "DB.example.com", instance: null };
    expect(describeSavedConnection(tcp).target).toBe("DB.example.com,1433");
    expect(describeSavedConnection({ ...tcp, port: 14333 }).target).toBe("DB.example.com,14333");
    // `db` and `db,1433` are the same endpoint, so the history keeps one entry for both.
    expect(savedConnectionKey(tcp)).toBe(savedConnectionKey({ ...tcp, port: 1433 }));
    // The Server field is refilled with what was typed, not with the canonical name.
    expect(savedConnectionToDraft(tcp).server).toBe("DB.example.com");
  });
});
