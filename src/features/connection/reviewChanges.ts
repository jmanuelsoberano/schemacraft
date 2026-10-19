import type { SchemaDiff } from "@/shared/contracts";

/**
 * Whether any table, view or relation appeared, disappeared or changed. Rust decides it with the
 * diff (`SchemaDiff::has_object_changes`), so the review never works it out again.
 */
export function hasObjectChanges(diff: SchemaDiff): boolean {
  return diff.hasObjectChanges;
}

/**
 * Whether applying the refresh would change nothing at all, as Rust `SchemaDiff::is_up_to_date`
 * decided it: no schema change, nothing kept unchecked, nothing newly readable or newly recorded
 * and the same access verdict. A refresh with any of these is worth applying even when no
 * object changed.
 */
export function isUpToDate(diff: SchemaDiff): boolean {
  return diff.isUpToDate;
}
