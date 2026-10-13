import type { InspectorErrorKind } from "@/shared/contracts";
import type { Translator } from "@/shared/i18n/useI18n";
import type { OperationError } from "@/shared/ipc/operationError";

type ErrorName = InspectorErrorKind | "unknownJob" | "ipcUnavailable" | "unexpected";

export interface ErrorPresentation {
  title: string;
  hint: string;
  /** Raw message from the backend, shown as secondary detail. */
  detail: string;
  /** Whether trusting the server certificate would address the failure. */
  offersCertificateTrust: boolean;
}

function errorName(error: OperationError): ErrorName {
  switch (error.kind.type) {
    case "inspector":
      return error.kind.value;
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
): ErrorPresentation {
  const name = errorName(error);
  return {
    title: translator.t(`error.${name}.title`),
    hint: translator.t(`error.${name}.hint`),
    detail: error.message,
    offersCertificateTrust: name === "untrustedCertificate",
  };
}
