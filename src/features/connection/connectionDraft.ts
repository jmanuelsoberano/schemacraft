import type {
  ConnectionSettings,
  EncryptionMode,
  InspectionOptions,
  PasswordSource,
} from "@/shared/contracts";

import { formatTarget, parseServerAddress } from "./serverAddress";
import {
  formatPostgreSqlTarget,
  isLocalPostgreSqlHost,
  parsePostgreSqlAddress,
} from "./postgreSqlAddress";
import type { PostgreSqlEncryptionMode } from "@/shared/contracts/generated/inspectors/PostgreSqlEncryptionMode";

export type AuthenticationMode = "integrated" | "sqlLogin";

/** What the user types in the connection dialog. Persisted without the password. */
export interface ConnectionDraft {
  provider: "sqlServer" | "postgreSql";
  server: string;
  authenticationMode: AuthenticationMode;
  username: string;
  password: string;
  /** Keep the typed password in the operating system credential store after connecting. */
  rememberPassword: boolean;
  /** A password is remembered for this server and login; an empty field means "use it". */
  passwordIsStored: boolean;
  database: string | null;
  /** Empty means every schema. */
  schemas: string[];
  includeViews: boolean;
  /** Read procedures, functions and triggers; on unless the user turns it off. */
  includeProgrammability: boolean;
  /** Save the code of views, procedures, functions and triggers in the project. */
  includeModuleDefinitions: boolean;
  /** Read known catalog references without requiring module source storage. */
  includeDependencies: boolean;
  encryption: EncryptionMode;
  trustServerCertificate: boolean;
  postgreSqlEncryption: PostgreSqlEncryptionMode;
  rootCertificate: string;
}

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;

export const emptyConnectionDraft: ConnectionDraft = {
  provider: "sqlServer",
  server: "",
  authenticationMode: "integrated",
  username: "",
  password: "",
  rememberPassword: false,
  passwordIsStored: false,
  database: null,
  schemas: [],
  includeViews: true,
  includeProgrammability: true,
  includeModuleDefinitions: true,
  includeDependencies: true,
  encryption: "mandatory",
  trustServerCertificate: false,
  postgreSqlEncryption: "verifyFull",
  rootCertificate: "",
};

export type DraftValidationError =
  | { field: "server"; reason: "empty" | "invalidPort" | "invalidAddress" }
  | { field: "username"; reason: "empty" }
  | { field: "postgreSqlEncryption"; reason: "localOnly" }
  | { field: "rootCertificate"; reason: "notPublicCertificate" };

export type DraftToSettings =
  | {
      ok: true;
      settings: ConnectionSettings;
      /** Canonical server name, spelled as Rust and the history spell it. */
      target: string;
    }
  | { ok: false; error: DraftValidationError };

/** Validates the draft and builds the settings sent to the Rust side. */
export function draftToSettings(
  draft: ConnectionDraft,
  database: string | null = draft.database,
): DraftToSettings {
  if (draft.provider === "postgreSql") {
    const parsed = parsePostgreSqlAddress(draft.server);
    if (!parsed.ok) return { ok: false, error: { field: "server", reason: parsed.reason } };
    if (draft.username.trim() === "")
      return { ok: false, error: { field: "username", reason: "empty" } };
    if (
      draft.postgreSqlEncryption !== "verifyFull" &&
      !isLocalPostgreSqlHost(parsed.address.host)
    ) {
      return { ok: false, error: { field: "postgreSqlEncryption", reason: "localOnly" } };
    }
    if (draft.rootCertificate.includes("PRIVATE KEY")) {
      return { ok: false, error: { field: "rootCertificate", reason: "notPublicCertificate" } };
    }
    return {
      ok: true,
      target: formatPostgreSqlTarget(parsed.address),
      settings: {
        provider: "postgreSql",
        host: parsed.address.host,
        port: parsed.address.port,
        database,
        username: draft.username,
        password: passwordSource(draft),
        encryption: draft.postgreSqlEncryption,
        rootCertificate: draft.rootCertificate.trim() === "" ? null : draft.rootCertificate,
        connectTimeoutSeconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
      },
    };
  }
  const parsed = parseServerAddress(draft.server);
  if (!parsed.ok) {
    return { ok: false, error: { field: "server", reason: parsed.reason } };
  }
  if (draft.authenticationMode === "sqlLogin" && draft.username.trim() === "") {
    return { ok: false, error: { field: "username", reason: "empty" } };
  }

  const { address } = parsed;
  const settings: ConnectionSettings = {
    provider: "sqlServer",
    host: address.host,
    instance: address.instance,
    port: address.port,
    database,
    authentication:
      draft.authenticationMode === "integrated"
        ? { mode: "integrated" }
        : { mode: "sqlLogin", username: draft.username.trim(), password: passwordSource(draft) },
    encryption: draft.encryption,
    trustServerCertificate: draft.trustServerCertificate,
    connectTimeoutSeconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
  };

  return { ok: true, settings, target: formatTarget(address) };
}

/** A typed password wins; an empty field falls back to the remembered one when there is one. */
function passwordSource(draft: ConnectionDraft): PasswordSource {
  if (draft.password === "" && draft.passwordIsStored) {
    return { source: "stored" };
  }
  return { source: "provided", value: draft.password };
}

export function draftToInspectionOptions(draft: ConnectionDraft): InspectionOptions {
  return {
    schemas: draft.schemas,
    includeViews: draft.includeViews,
    includeProgrammability: draft.includeProgrammability,
    includeModuleDefinitions: draft.includeModuleDefinitions,
    includeDependencies: draft.includeDependencies,
  };
}
