/**
 * A SQL Server identifier in brackets, safe inside a statement: `sales` becomes `[sales]` and a
 * closing bracket inside the name is doubled, as `QUOTENAME` does, so `odd]name` becomes
 * `[odd]]name]`. The brackets protect nothing outside a statement: a `--` comment still ends at
 * the first line break of the name.
 */
export function quoteIdentifier(name: string): string {
  return `[${name.replaceAll("]", "]]")}]`;
}
