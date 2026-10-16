import type { Column, SqlDataType } from "@/shared/contracts";

import { definitionText, isUnknownDefinition } from "./definition";

/** SQL declaration of a type, e.g. `nvarchar(120)`, `decimal(18,2)` or `varbinary(max)`. */
export function formatDataType(type: SqlDataType): string {
  const name = type.userDefinedTypeName ?? type.name;
  if (type.length !== null) {
    return `${name}(${type.length.kind === "max" ? "max" : String(type.length.value)})`;
  }
  if (type.precision !== null && type.scale !== null) {
    return `${name}(${type.precision},${type.scale})`;
  }
  if (type.precision !== null) {
    return `${name}(${type.precision})`;
  }
  return name;
}

/** Translated phrases {@link describeColumn} prints for a default whose text is missing. */
export interface DefaultLabels {
  /** A default exists but its text is not visible, e.g. `DEFAULT (not available)`. */
  notAvailable: string;
  /**
   * A SchemaCraft 1.0 file did not record whether there is a default, e.g. `default not
   * recorded`. It must not name the `DEFAULT` keyword, which would claim that one exists.
   */
  notRecorded: string;
}

/**
 * Type, nullability and attributes on one line, e.g. `int NOT NULL` or
 * `datetime2(7) NULL DEFAULT (sysutcdatetime())`. A default whose text is missing is never
 * dropped silently: it reads as one of `labels`.
 */
export function describeColumn(column: Column, labels: DefaultLabels): string {
  const parts = [formatDataType(column.dataType), column.isNullable ? "NULL" : "NOT NULL"];
  if (column.isIdentity) {
    parts.push("IDENTITY");
  }
  if (column.isComputed) {
    parts.push("COMPUTED");
  }
  const { defaultExpression } = column;
  if (defaultExpression !== null) {
    const text = definitionText(defaultExpression);
    if (text !== null) {
      parts.push(`DEFAULT ${text}`);
    } else {
      parts.push(isUnknownDefinition(defaultExpression) ? labels.notRecorded : labels.notAvailable);
    }
  }
  return parts.join(" ");
}
