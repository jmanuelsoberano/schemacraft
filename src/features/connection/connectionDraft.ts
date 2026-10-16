import type {
  ConnectionSettings,
  EncryptionMode,
  InspectionOptions,
  PasswordSource,
} from "@/shared/contracts";

import { formatTarget, parseServerAddress } from "./serverAddress";

export type AuthenticationMode = "integrated" | "sqlLogin";

/** What the user types in the connection dialog. Persisted without the password. */
export interface ConnectionDraft {
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
  encryption: EncryptionMode;
  trustServerCertificate: boolean;
}

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;

export const emptyConnectionDraft: ConnectionDraft = {
  server: "",
  authenticationMode: "integrated",
  username: "",
  password: "",
  rememberPassword: false,
  passwordIsStored: false,
  database: null,
  schemas: [],
  includeViews: true,
  encryption: "mandatory",
  trustServerCertificate: false,
};

export type DraftValidationError =
  { field: "server"; reason: "empty" | "invalidPort" } | { field: "username"; reason: "empty" };

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
  return { schemas: draft.schemas, includeViews: draft.includeViews };
}
