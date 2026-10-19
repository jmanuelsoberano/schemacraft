import { accessSummary } from "@/features/schema/coverage";
import { entityKey } from "@/features/schema/entities";
import type { ModuleRef } from "@/features/schema/modules";
import type { DetailsScope } from "@/features/schema/objectDetails";
import type { InspectionOptions, NodeState, SchemaSnapshot } from "@/shared/contracts";

/**
 * What the Inspector knows beyond the snapshot: which entities the canvas hides, so a relation
 * to one of them is text rather than a link; the capture's verdicts and the facts it kept from
 * an earlier read, so every list says how complete it is; and whether the read was narrowed to
 * some schemas, which drops the keys that leave them. The whole project is known, unlike in an
 * exported file, so a list is never "the diagram only".
 */
export function inspectorScope(
  snapshot: SchemaSnapshot,
  nodes: readonly NodeState[],
  inspection: InspectionOptions,
): DetailsScope {
  return {
    hiddenKeys: new Set(nodes.filter((node) => node.isHidden).map((node) => entityKey(node.name))),
    coverage: accessSummary(snapshot)?.coverage ?? null,
    carriedOver: snapshot.carriedOver ?? [],
    isSchemaFiltered: inspection.schemas.length > 0,
    isDiagramOnly: false,
    definitions: "included",
  };
}

export type InspectedTarget =
  | { kind: "entity"; key: string }
  | { kind: "multiple"; count: number }
  | { kind: "module"; ref: ModuleRef }
  | { kind: "none" };

/** Entity selection takes precedence even if a caller supplies an inconsistent transient state. */
export function inspectedTarget(
  selectedKeys: readonly string[],
  selectedModule: ModuleRef | null,
): InspectedTarget {
  const key = selectedKeys[0];
  if (selectedKeys.length === 1 && key !== undefined) return { kind: "entity", key };
  if (selectedKeys.length > 1) return { kind: "multiple", count: selectedKeys.length };
  return selectedModule === null ? { kind: "none" } : { kind: "module", ref: selectedModule };
}
