import type { Definition } from "@/shared/contracts";

/**
 * Text of a `CHECK` or `DEFAULT` expression when the capture could read it, otherwise `null`.
 * A missing text never means a missing expression: ask {@link isUnknownDefinition} why it is
 * missing. These two functions are the only readers of the raw statuses.
 */
export function definitionText(definition: Definition): string | null {
  return definition.status === "readable" ? definition.text : null;
}

/**
 * Whether it is unknown that the expression exists at all: a SchemaCraft 1.0 file recorded
 * nothing for it, so it reads "not recorded". Any other missing text belongs to an expression
 * that exists but is not visible to the login, or comes in a state written by a newer version;
 * both read "not available".
 */
export function isUnknownDefinition(definition: Definition): boolean {
  return definition.status === "notRecorded";
}
