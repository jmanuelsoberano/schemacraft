import { describe, expect, it } from "vitest";

import type { ConnectionSettings, SavedConnection } from "@/shared/contracts";

import {
  describeSavedConnection,
  savedConnectionKey,
  savedConnectionToDraft,
  toSavedConnection,
} from "./savedConnection";

const settings: ConnectionSettings = {
  provider: "sqlServer",
  host: "db.example.com",
  instance: null,
  port: 14333,
  database: "Northwind",
  authentication: { mode: "sqlLogin", username: "reporting", password: "s3cret" },
  encryption: "mandatory",
  trustServerCertificate: true,
  connectTimeoutSeconds: 15,
};

describe("toSavedConnection", () => {
  it("keeps the endpoint and the login name but never the password", () => {
    const saved = toSavedConnection(settings);
    expect(saved).toEqual({
      provider: "sqlServer",
      host: "db.example.com",
      instance: null,
      port: 14333,
      database: "Northwind",
      authentication: { mode: "sqlLogin", username: "reporting" },
      encryption: "mandatory",
      trustServerCertificate: true,
    });
    expect(JSON.stringify(saved)).not.toContain("s3cret");
  });

  it("records Windows Authentication without a login name", () => {
    const saved = toSavedConnection({
      ...settings,
      authentication: { mode: "integrated" },
    });
    expect(saved.authentication).toEqual({ mode: "integrated" });
  });
});

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
    const draft = savedConnectionToDraft(saved, { schemas: ["sales"], includeViews: false });
    expect(draft).toMatchObject({
      server: "localhost\\SQLEXPRESS",
      authenticationMode: "sqlLogin",
      username: "app",
      password: "",
      database: "Shop",
      schemas: ["sales"],
      includeViews: false,
      encryption: "optional",
      trustServerCertificate: true,
    });
  });

  it("defaults to every schema and views included", () => {
    const draft = savedConnectionToDraft({ ...saved, authentication: { mode: "integrated" } });
    expect(draft.authenticationMode).toBe("integrated");
    expect(draft.username).toBe("");
    expect(draft.schemas).toEqual([]);
    expect(draft.includeViews).toBe(true);
  });

  it("describes and keys connections by endpoint", () => {
    expect(describeSavedConnection(saved)).toEqual({
      target: "localhost\\SQLEXPRESS",
      database: "Shop",
      login: "app",
    });
    expect(savedConnectionKey(saved)).toBe("localhost\\sqlexpress|shop|app");
    expect(savedConnectionKey({ ...saved, authentication: { mode: "integrated" } })).toBe(
      "localhost\\sqlexpress|shop|<windows>",
    );
  });
});
