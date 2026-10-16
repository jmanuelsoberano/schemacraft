import { accessSummary } from "@/features/schema/coverage";
import { entityKey } from "@/features/schema/entities";
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
  };
}

/**
 * The entity the Inspector shows: the selection when it holds exactly one key. Nothing or
 * several selected is an empty state, so the panel never shows what the canvas does not mark.
 */
export function inspectedKey(selectedKeys: readonly string[]): string | null {
  return selectedKeys.length === 1 ? (selectedKeys[0] ?? null) : null;
}
