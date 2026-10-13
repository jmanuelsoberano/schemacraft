/** Joins class names, skipping falsy entries so conditional classes read naturally. */
export function classNames(...values: readonly (string | false | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value !== "")
    .join(" ");
}
