import type { DiffSummary } from "@/shared/contracts";

/** Total number of reported changes across tables, views and relations. */
export function countChanges(summary: DiffSummary): number {
  return [summary.tables, summary.views, summary.foreignKeys].reduce(
    (total, counts) => total + counts.added + counts.removed + counts.changed,
    0,
  );
}
