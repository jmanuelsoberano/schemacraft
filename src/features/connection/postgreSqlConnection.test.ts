import { describe, expect, it } from "vitest";

import { toSavedConnection } from "@/features/project/savedConnection";
import { savedCredentialIdentity } from "@/shared/connections/savedConnectionIdentity";
import type { SavedConnection } from "@/shared/contracts";

import { draftToSettings, emptyConnectionDraft } from "./connectionDraft";
import {
  describeSavedConnection,
  savedConnectionKey,
  savedConnectionToDraft,
  savedConnectionToSettings,
} from "./fromSavedConnection";

const saved: Extract<SavedConnection, { provider: "postgreSql" }> = {
  provider: "postgreSql",
  host: "::1",
  port: 15432,
  database: "CaseDatabase",
  username: "CaseRole",
  encryption: "verifyFull",
  rootCertificate: "-----BEGIN CERTIFICATE-----\nPUBLIC_TEST_CA\n-----END CERTIFICATE-----",
};

describe("native PostgreSQL connection policy", () => {
  it("defaults to verified TLS and preserves role/database identity through save and reopen", () => {
    const result = draftToSettings({
      ...emptyConnectionDraft,
      provider: "postgreSql",
      server: "[::1]:15432",
      username: "CaseRole",
      password: "PRIVATE_PASSWORD",
      database: "CaseDatabase",
      rootCertificate: saved.rootCertificate ?? "",
    });
    if (!result.ok || result.settings.provider !== "postgreSql")
      throw new Error("PostgreSQL settings expected");
    expect(result.settings).toMatchObject({
      host: "::1",
      port: 15432,
      database: "CaseDatabase",
      username: "CaseRole",
      encryption: "verifyFull",
      password: { source: "provided", value: "PRIVATE_PASSWORD" },
    });
    const persisted = toSavedConnection(result.settings);
    expect(persisted).toEqual(saved);
    expect(JSON.stringify(persisted)).not.toContain("PRIVATE_PASSWORD");
    const draft = savedConnectionToDraft(persisted);
    expect(draft).toMatchObject({
      provider: "postgreSql",
      server: "[::1]:15432",
      username: "CaseRole",
      database: "CaseDatabase",
      password: "",
      postgreSqlEncryption: "verifyFull",
    });
    expect(savedConnectionToSettings(persisted, { source: "stored" })).toMatchObject({
      provider: "postgreSql",
      password: { source: "stored" },
      username: "CaseRole",
    });
    expect(describeSavedConnection(persisted).target).toBe("[::1]:15432");
  });

  it("does not fold role/database case or collide with the SQL Server secret namespace", () => {
    expect(savedConnectionKey(saved)).not.toBe(
      savedConnectionKey({ ...saved, username: "caserole" }),
    );
    expect(savedConnectionKey(saved)).not.toBe(
      savedConnectionKey({ ...saved, database: "casedatabase" }),
    );
    expect(savedCredentialIdentity(saved)).not.toBe(
      savedCredentialIdentity({
        provider: "sqlServer",
        host: "::1",
        instance: null,
        port: 15432,
        database: "CaseDatabase",
        authentication: { mode: "sqlLogin", username: "CaseRole" },
        encryption: "mandatory",
        trustServerCertificate: false,
      }),
    );
    expect(savedCredentialIdentity(saved)).not.toBe(
      savedCredentialIdentity({ ...saved, username: "caserole" }),
    );
  });

  it("requires explicit local transport exceptions and rejects private keys", () => {
    for (const postgreSqlEncryption of ["require", "disable"] as const) {
      expect(
        draftToSettings({
          ...emptyConnectionDraft,
          provider: "postgreSql",
          server: "db.example.test",
          username: "CaseRole",
          postgreSqlEncryption,
        }),
      ).toEqual({ ok: false, error: { field: "postgreSqlEncryption", reason: "localOnly" } });
      expect(
        draftToSettings({
          ...emptyConnectionDraft,
          provider: "postgreSql",
          server: "localhost:15432",
          username: "CaseRole",
          postgreSqlEncryption,
        }).ok,
      ).toBe(true);
    }
    expect(
      draftToSettings({
        ...emptyConnectionDraft,
        provider: "postgreSql",
        server: "localhost",
        username: "CaseRole",
        rootCertificate: "-----BEGIN PRIVATE KEY-----\nPRIVATE_TEST_KEY",
      }),
    ).toEqual({ ok: false, error: { field: "rootCertificate", reason: "notPublicCertificate" } });
  });
});
