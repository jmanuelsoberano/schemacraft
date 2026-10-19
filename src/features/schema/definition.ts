import type { Definition } from "@/shared/contracts";

/**
 * Text of a `CHECK` or `DEFAULT` expression, or of a SQL module, when the capture could read it,
 * otherwise `null`. A missing text never means a missing expression: ask
 * {@link isUnknownDefinition} and {@link isEncryptedDefinition} why it is missing. The functions
 * of this file are the only readers of the raw statuses.
 */
export function definitionText(definition: Definition): string | null {
  return definition.status === "readable" ? definition.text : null;
}

/**
 * Whether it is unknown that the expression exists at all: a SchemaCraft 1.0 file recorded
 * nothing for it, so it reads "not recorded". Any other missing text belongs to an expression
 * that exists but is not visible to the login, to an encrypted module, or comes in a state
 * written by a newer version; those read "not available" unless {@link isEncryptedDefinition}
 * says why.
 */
export function isUnknownDefinition(definition: Definition): boolean {
  return definition.status === "notRecorded";
}

/**
 * Whether the text belongs to a module created `WITH ENCRYPTION`, whose text SQL Server keeps
 * from every login, the database owner included. Only module texts take this state; it is a
 * property of the module, not a gap in what the login could see.
 */
export function isEncryptedDefinition(definition: Definition): boolean {
  return definition.status === "encrypted";
}

/**
 * The definition with no text left in it, for what may leave the application. A readable text,
 * and any state this version does not know, which a newer version might give a text, become
 * `unknown`; the states that say why a text is missing travel as they are. The result is always
 * built anew, so nothing of the input but its status can come along.
 */
export function withoutText(definition: Definition): Definition {
  switch (definition.status) {
    case "notVisible":
      return { status: "notVisible" };
    case "encrypted":
      return { status: "encrypted" };
    case "notRecorded":
      return { status: "notRecorded" };
    // A readable text, the open fallback, or a state a newer version might give a text.
    case "readable":
    case "unknown":
    default:
      return { status: "unknown" };
  }
}
