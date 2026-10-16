import type { CommandError, CommandErrorKind, InspectorErrorKind } from "@/shared/contracts";

/** The kinds the Rust side reports, plus the one only the frontend can detect. */
export type OperationErrorKind = CommandErrorKind | { type: "ipcUnavailable" };

/** Normalised failure of an IPC call, safe to show and to translate. */
export class OperationError extends Error {
  readonly kind: OperationErrorKind;

  constructor(kind: OperationErrorKind, message: string) {
    super(message);
    this.name = "OperationError";
    this.kind = kind;
  }
}

function isCommandError(value: unknown): value is CommandError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { kind?: unknown; message?: unknown };
  if (typeof candidate.message !== "string") {
    return false;
  }
  return (
    typeof candidate.kind === "object" &&
    candidate.kind !== null &&
    typeof (candidate.kind as { type?: unknown }).type === "string"
  );
}

/** Turns whatever a rejected `invoke` produced into an {@link OperationError}. */
export function toOperationError(error: unknown): OperationError {
  if (error instanceof OperationError) {
    return error;
  }
  if (isCommandError(error)) {
    return new OperationError(error.kind, error.message);
  }
  if (error instanceof Error) {
    return new OperationError({ type: "unexpected" }, error.message);
  }
  return new OperationError(
    { type: "unexpected" },
    typeof error === "string" ? error : "Unknown error",
  );
}

export function ipcUnavailableError(): OperationError {
  return new OperationError(
    { type: "ipcUnavailable" },
    "The desktop runtime is not available in this window.",
  );
}

/** The inspector classification behind an error, when there is one. */
export function inspectorErrorKind(error: OperationError): InspectorErrorKind | null {
  return error.kind.type === "inspector" ? error.kind.value : null;
}
