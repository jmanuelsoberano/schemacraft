import { describe, expect, it } from "vitest";

import { draftToInspectionOptions, draftToSettings, emptyConnectionDraft } from "./connectionDraft";

describe("draftToSettings", () => {
  it("builds integrated authentication settings with a named instance", () => {
    const result = draftToSettings({ ...emptyConnectionDraft, server: "localhost\\SQLEXPRESS" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toBe("localhost\\SQLEXPRESS");
      expect(result.settings).toMatchObject({
        provider: "sqlServer",
        host: "localhost",
        instance: "SQLEXPRESS",
        port: null,
        database: null,
        authentication: { mode: "integrated" },
        encryption: "mandatory",
        trustServerCertificate: false,
      });
    }
  });

  it("builds SQL login settings and trims the login name", () => {
    const result = draftToSettings(
      {
        ...emptyConnectionDraft,
        server: "db,14333",
        authenticationMode: "sqlLogin",
        username: " sa ",
        password: "secret",
      },
      "Northwind",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.database).toBe("Northwind");
      expect(result.settings.authentication).toEqual({
        mode: "sqlLogin",
        username: "sa",
        password: { source: "provided", value: "secret" },
      });
      expect(result.settings.port).toBe(14333);
      expect(result.target).toBe("db,14333");
    }
  });

  it("names a server without a port the way Rust does", () => {
    const result = draftToSettings({ ...emptyConnectionDraft, server: "db.example.com" });
    expect(result.ok && result.target).toBe("db.example.com,1433");
  });

  it("uses the remembered password when the field is empty", () => {
    const result = draftToSettings({
      ...emptyConnectionDraft,
      server: "db",
      authenticationMode: "sqlLogin",
      username: "sa",
      password: "",
      passwordIsStored: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.authentication).toEqual({
        mode: "sqlLogin",
        username: "sa",
        password: { source: "stored" },
      });
    }
  });

  it("reports the field that is invalid", () => {
    expect(draftToSettings(emptyConnectionDraft)).toEqual({
      ok: false,
      error: { field: "server", reason: "empty" },
    });
    expect(
      draftToSettings({ ...emptyConnectionDraft, server: "host", authenticationMode: "sqlLogin" }),
    ).toEqual({ ok: false, error: { field: "username", reason: "empty" } });
  });
});

describe("draftToInspectionOptions", () => {
  it("passes the schema filter and view preference through", () => {
    expect(
      draftToInspectionOptions({
        ...emptyConnectionDraft,
        schemas: ["sales"],
        includeViews: false,
      }),
    ).toEqual({
      schemas: ["sales"],
      includeViews: false,
      includeProgrammability: true,
      includeModuleDefinitions: true,
    });
  });

  it("reads and saves code unless the user turns it off", () => {
    expect(draftToInspectionOptions(emptyConnectionDraft)).toMatchObject({
      includeProgrammability: true,
      includeModuleDefinitions: true,
    });
    expect(
      draftToInspectionOptions({
        ...emptyConnectionDraft,
        includeProgrammability: false,
        includeModuleDefinitions: false,
      }),
    ).toMatchObject({ includeProgrammability: false, includeModuleDefinitions: false });
  });
});
