/** Code identities and kind counts shared by the review and access report. */
import type { CodeObjectRef, SchemaSnapshot } from "@/shared/contracts";
import { qualifiedNameLabel } from "./entities";

export type CodeKind = "procedure" | "function" | "trigger" | "view" | "unknown";

export function codeObjectName(object: CodeObjectRef): string {
  switch (object.kind) {
    case "routine":
    case "view":
      return qualifiedNameLabel(object.name);
    case "trigger":
      return `${qualifiedNameLabel(object.parent)} · ${object.name}`;
    case "unknown":
      return "";
  }
}

export function codeObjectKind(
  object: CodeObjectRef,
  snapshot: SchemaSnapshot,
  previous?: SchemaSnapshot,
): CodeKind {
  if (object.kind !== "routine") return object.kind;
  const kind = [
    ...(snapshot.programmability?.routines ?? []),
    ...(previous?.programmability?.routines ?? []),
  ].find(
    (routine) =>
      routine.name.schema === object.name.schema && routine.name.name === object.name.name,
  )?.kind;
  return kind === "procedure"
    ? "procedure"
    : kind === undefined || kind === "unknown"
      ? "unknown"
      : "function";
}

/** Counts objects once even when both the object and its text were kept separately. */
export function groupCodeFacts<Entry extends { object: CodeObjectRef }>(
  entries: readonly Entry[],
  snapshot: SchemaSnapshot,
  previous?: SchemaSnapshot,
): { kind: CodeKind; count: number; entries: Entry[] }[] {
  return (["procedure", "function", "trigger", "view", "unknown"] as const).flatMap((kind) => {
    const group = entries.filter(
      (entry) => codeObjectKind(entry.object, snapshot, previous) === kind,
    );
    return group.length === 0
      ? []
      : [
          {
            kind,
            count: new Set(group.map((entry) => JSON.stringify(entry.object))).size,
            entries: group,
          },
        ];
  });
}
