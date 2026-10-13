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
        password: "secret",
      });
      expect(result.settings.port).toBe(14333);
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
    ).toEqual({ schemas: ["sales"], includeViews: false });
  });
});
