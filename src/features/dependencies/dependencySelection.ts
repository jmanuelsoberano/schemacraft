import { entityKey } from "@/features/schema/entities";
import type { CodeObjectRef, DependencyObjectRef, SchemaSnapshot } from "@/shared/contracts";

/** Translate selection identities without guessing an object's kind from its display name. */
export function dependencyObjectForEntity(
  snapshot: SchemaSnapshot,
  key: string,
): DependencyObjectRef | null {
  const table = snapshot.tables.find((table) => entityKey(table.name) === key);
  if (table !== undefined) return { kind: "table", name: table.name };
  const view = snapshot.views.find((view) => entityKey(view.name) === key);
  return view === undefined ? null : { kind: "view", name: view.name };
}

export function dependencyObjectForModule(ref: CodeObjectRef): DependencyObjectRef | null {
  switch (ref.kind) {
    case "view":
      return { kind: "view", name: ref.name };
    case "routine":
      return { kind: "routine", name: ref.name };
    case "routineOverload":
      return { kind: "routine", name: ref.name, identityArguments: ref.argumentTypes };
    case "trigger":
      return { kind: "trigger", parent: ref.parent, name: ref.name };
    case "unknown":
      return null;
  }
}
