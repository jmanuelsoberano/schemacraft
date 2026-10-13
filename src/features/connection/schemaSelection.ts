/**
 * Updates a schema selection where an empty list means "all schemas". Selecting every schema
 * individually collapses back to the empty list, so the inspection options stay canonical.
 */
export function toggleSchema(
  allSchemas: readonly string[],
  selected: readonly string[],
  schema: string,
  checked: boolean,
): string[] {
  const current = selected.length === 0 ? [...allSchemas] : [...selected];
  const next = checked
    ? current.includes(schema)
      ? current
      : [...current, schema]
    : current.filter((candidate) => candidate !== schema);

  const everySchemaSelected = allSchemas.every((candidate) => next.includes(candidate));
  return everySchemaSelected ? [] : allSchemas.filter((candidate) => next.includes(candidate));
}
