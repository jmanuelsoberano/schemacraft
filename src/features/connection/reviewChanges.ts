import type { DiffSummary, SchemaDiff } from "@/shared/contracts";

/** Total number of reported changes across tables, views and relations. */
export function countChanges(summary: DiffSummary): number {
  return [summary.tables, summary.views, summary.foreignKeys].reduce(
    (total, counts) => total + counts.added + counts.removed + counts.changed,
    0,
  );
}

/**
 * Whether applying the refresh would change nothing at all, as Rust `SchemaDiff::is_up_to_date`
 * decides: no schema change, nothing kept unchecked, nothing newly readable and the same access
 * verdict. A refresh with any of these is worth applying even when no object changed.
 */
export function isUpToDate(diff: SchemaDiff): boolean {
  return (
    countChanges(diff.summary) === 0 &&
    diff.notChecked.length === 0 &&
    diff.nowAvailable.length === 0 &&
    !diff.accessChanged
  );
}
