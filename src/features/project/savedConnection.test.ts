import { describe, expect, it } from "vitest";

import type { ConnectionSettings } from "@/shared/contracts";

import { toSavedConnection } from "./savedConnection";

const settings: ConnectionSettings = {
  provider: "sqlServer",
  host: "db.example.com",
  instance: null,
  port: 14333,
  database: "Northwind",
  authentication: {
    mode: "sqlLogin",
    username: "reporting",
    password: { source: "provided", value: "s3cret" },
  },
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
