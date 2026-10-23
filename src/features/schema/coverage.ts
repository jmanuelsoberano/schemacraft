// How complete a snapshot is, read from the access profile frozen in it. Lists, counts and empty
// states ask these helpers before they claim that something does not exist.
import type {
  AccessProfile,
  Completeness,
  InspectionOptions,
  SchemaSnapshot,
} from "@/shared/contracts";

/**
 * The verdicts of a capture's access profile without its probe: what may travel with a diagram,
 * into an export for instance, without naming schemas, permissions or the database user.
 */
export type AccessSummary = Pick<AccessProfile, "level" | "coverage">;

/**
 * The verdicts of the snapshot's capture, or `null` when it recorded none (a 1.0 file). The
 * coverage is rebuilt from the objects and the `CHECK` and `DEFAULT` texts, which are what the
 * level judges and what a diagram shows; the coverage of code stays behind, so an export never
 * speaks of code it does not contain.
 */
export function accessSummary(snapshot: SchemaSnapshot): AccessSummary | null {
  if (snapshot.access === undefined) {
    return null;
  }
  const { level, coverage } = snapshot.access;
  return { level, coverage: { objects: coverage.objects, definitions: coverage.definitions } };
}

/** Completeness of one kind of fact; `notRecorded` for a snapshot written by SchemaCraft 1.0. */
export type FactCoverage = Completeness | "notRecorded";

/**
 * Completeness of the list of tables and views. `partial` means an object missing from the list
 * may still exist; `notRecorded` means the snapshot predates access profiles.
 */
export type ObjectsCoverage = "complete" | "partial" | "notRecorded";

export function objectsCoverage(snapshot: SchemaSnapshot): ObjectsCoverage {
  const objects = snapshot.access?.coverage.objects;
  if (objects === undefined) {
    return "notRecorded";
  }
  // A list nothing could be read into holds at most part of what exists.
  return objects === "complete" ? "complete" : "partial";
}

/** Completeness of the `CHECK` and `DEFAULT` texts. */
export function definitionsCoverage(snapshot: SchemaSnapshot): FactCoverage {
  return snapshot.access?.coverage.definitions ?? "notRecorded";
}

/** Coverage of code is independent of the tables-and-expressions access verdict. */
export function programmabilityCoverage(snapshot: SchemaSnapshot): FactCoverage {
  return snapshot.access?.coverage.programmability ?? "notRecorded";
}

export function moduleDefinitionsCoverage(snapshot: SchemaSnapshot): FactCoverage {
  return snapshot.access?.coverage.moduleDefinitions ?? "notRecorded";
}

/** Why a routines list cannot vouch for absences, without treating a failed read as permissions. */
export type RoutinesListNotice =
  | "partial"
  | "notRecorded"
  | "optionOff"
  | "queryFailed"
  | "timedOut"
  | "permissionDenied"
  | "unknown";

export function routinesListNotice(snapshot: SchemaSnapshot): RoutinesListNotice | null {
  const capture = snapshot.programmability?.capture.objects;
  if (capture === undefined) return "notRecorded";
  if (capture.status === "unknown") return "unknown";
  if (capture.status === "notRead") return capture.reason;
  return programmabilityCoverage(snapshot) === "complete" ? null : "partial";
}

/**
 * Whether a table or view missing from the snapshot, or a count of zero, is a fact. A capture that
 * recorded partial access cannot vouch for absences; a SchemaCraft 1.0 snapshot recorded nothing
 * and keeps the reading it always had.
 */
export function listsEveryObject(snapshot: SchemaSnapshot): boolean {
  return objectsCoverage(snapshot) !== "partial";
}

/**
 * Why a snapshot holds no listed object: the database has none, the schemas and options chosen
 * for the read leave none, or the login sees none of those that may exist.
 */
export type EmptySchemaReason = "database" | "selection" | "notVisible";

/** A code-only snapshot is still an inspectable collection of objects. */
export function emptySchemaReason(
  snapshot: SchemaSnapshot,
  inspection: InspectionOptions,
): EmptySchemaReason | null {
  if (
    snapshot.tables.length > 0 ||
    snapshot.views.length > 0 ||
    (snapshot.programmability?.routines.length ?? 0) > 0
  ) {
    return null;
  }
  if (!listsEveryObject(snapshot)) {
    return "notVisible";
  }
  return inspection.schemas.length > 0 || !inspection.includeViews ? "selection" : "database";
}
