import type { Column, SqlDataType } from "@/shared/contracts";

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

/** Type and nullability on one line, e.g. `int NOT NULL` or `nvarchar(max) NULL`. */
export function describeColumn(column: Column): string {
  const parts = [formatDataType(column.dataType), column.isNullable ? "NULL" : "NOT NULL"];
  if (column.isIdentity) {
    parts.push("IDENTITY");
  }
  if (column.isComputed) {
    parts.push("COMPUTED");
  }
  if (column.defaultExpression !== null) {
    parts.push(`DEFAULT ${column.defaultExpression}`);
  }
  return parts.join(" ");
}
