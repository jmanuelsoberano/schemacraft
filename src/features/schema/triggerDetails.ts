import type {
  CarriedFact,
  NotReadReason,
  QualifiedName,
  SchemaSnapshot,
  Trigger,
} from "@/shared/contracts";

/** Trigger metadata follows its parent, independently of permission to read module text. */
export type TriggerCapture =
  | { status: "complete" }
  | { status: "notRecorded" }
  | { status: "notRead"; reason: NotReadReason }
  | { status: "notChecked"; readAt: string };

function sameName(left: QualifiedName, right: QualifiedName): boolean {
  return left.schema === right.schema && left.name === right.name;
}

/** Shared by detail lists and badge eligibility; an absent list is not proof of no triggers. */
export function triggerCapture(
  snapshot: SchemaSnapshot,
  parent: QualifiedName,
  carriedFacts: readonly CarriedFact[] = snapshot.carriedOver ?? [],
): TriggerCapture {
  const capture = snapshot.programmability?.capture.objects;
  if (capture === undefined || capture.status === "unknown") return { status: "notRecorded" };
  if (capture.status === "notRead" && capture.reason === "optionOff") return capture;
  const parentDates = carriedFacts
    .filter(
      (item) =>
        sameName(item.object, parent) && (item.fact.kind === "table" || item.fact.kind === "view"),
    )
    .map((item) => item.readAt);
  const triggerDates = (snapshot.programmability?.carriedOver ?? [])
    .filter(
      (item) =>
        item.part === "whole" &&
        item.object.kind === "trigger" &&
        sameName(item.object.parent, parent),
    )
    .map((item) => item.readAt);
  // A later parent read may have failed to read code; it cannot advance an older trigger date.
  const readAt = [...parentDates, ...triggerDates].sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  )[0];
  if (readAt !== undefined) return { status: "notChecked", readAt };
  return capture.status === "read" ? { status: "complete" } : capture;
}

/** Definition-only retention does not make trigger metadata stale. */
export function triggerReadAt(
  snapshot: SchemaSnapshot,
  trigger: Pick<Trigger, "parent" | "name">,
): string | null {
  return (
    snapshot.programmability?.carriedOver?.find(
      (item) =>
        item.part === "whole" &&
        item.object.kind === "trigger" &&
        sameName(item.object.parent, trigger.parent) &&
        item.object.name === trigger.name,
    )?.readAt ?? null
  );
}

/** Timing first, then enabled state, then the exact name; never imply a global firing order. */
export function triggersOf(snapshot: SchemaSnapshot, parent: QualifiedName): Trigger[] {
  const timing = { insteadOf: 0, after: 1, unknown: 2 };
  return (snapshot.programmability?.triggers ?? [])
    .filter((trigger) => sameName(trigger.parent, parent))
    .sort(
      (left, right) =>
        timing[left.timing] - timing[right.timing] ||
        Number(right.isEnabled) - Number(left.isEnabled) ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
}
