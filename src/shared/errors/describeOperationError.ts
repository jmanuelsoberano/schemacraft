import type {
  CredentialErrorKind,
  ExportErrorKind,
  InspectorErrorKind,
  PreferencesErrorKind,
  ProjectErrorKind,
} from "@/shared/contracts";
import type { MessageKey } from "@/shared/i18n/messages/en";
import type { Translator } from "@/shared/i18n/useI18n";
import type { OperationError } from "@/shared/ipc/operationError";

type ErrorName =
  | InspectorErrorKind
  | `project.${ProjectErrorKind}`
  | `preferences.${PreferencesErrorKind}`
  | `credential.${CredentialErrorKind}`
  | `export.${ExportErrorKind}`
  | "invalidArgument"
  | "unknownJob"
  | "ipcUnavailable"
  | "unexpected";

export interface ErrorPresentation {
  title: string;
  hint: string;
  /** Raw message from the backend, shown as secondary detail. */
  detail: string;
  /** Whether trusting the server certificate would address the failure. */
  offersCertificateTrust: boolean;
}

/** What the user was attempting, so the guidance can match it. */
export interface ErrorContext {
  /** True when the failed operation signed in with the Windows account. */
  usesIntegratedAuthentication?: boolean;
}

function errorName(error: OperationError): ErrorName {
  switch (error.kind.type) {
    case "inspector":
      return error.kind.value;
    case "project":
      return `project.${error.kind.value}`;
    case "preferences":
      return `preferences.${error.kind.value}`;
    case "credential":
      return `credential.${error.kind.value}`;
    case "export":
      return `export.${error.kind.value}`;
    case "invalidArgument":
      return "invalidArgument";
    case "unknownJob":
      return "unknownJob";
    case "ipcUnavailable":
      return "ipcUnavailable";
    case "unexpected":
      return "unexpected";
  }
}

/** Title, guidance and remedy for an error, in the current language. */
export function describeOperationError(
  error: OperationError,
  translator: Translator,
  context: ErrorContext = {},
): ErrorPresentation {
  const name = errorName(error);
  return {
    title: translator.t(`error.${name}.title`),
    hint: translator.t(hintKey(name, context)),
    detail: error.message,
    offersCertificateTrust: name === "untrustedCertificate",
  };
}

function hintKey(name: ErrorName, context: ErrorContext): MessageKey {
  // A rejected Windows account calls for different advice than a wrong password.
  if (name === "authenticationFailed" && context.usesIntegratedAuthentication === true) {
    return "error.authenticationFailed.hint.integrated";
  }
  return `error.${name}.hint`;
}
