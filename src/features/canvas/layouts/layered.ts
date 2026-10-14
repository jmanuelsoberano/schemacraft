import type { ELK, ElkNode } from "elkjs/lib/elk-api";

import type { LayoutInput, LayoutResult } from "./layoutGraph";
import { normalizePositions } from "./layoutGraph";

export type LayeredDirection = "down" | "right";

/** Produces an ELK instance; the application uses a worker, tests the bundled engine. */
export type ElkFactory = () => ELK;

const NODE_SPACING = 48;
const LAYER_SPACING = 110;

/** The ELK graph for a layout input, in ELK's JSON format. */
export function toElkGraph(input: LayoutInput, direction: LayeredDirection): ElkNode {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "down" ? "DOWN" : "RIGHT",
      "elk.spacing.nodeNode": String(NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_SPACING),
      "elk.layered.spacing.edgeNodeBetweenLayers": "32",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "96",
    },
    children: input.nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
    // Parents above children: the referenced table is the source of the ELK edge.
    edges: input.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.target],
      targets: [edge.source],
    })),
  };
}

/** Top-left positions from an ELK result. */
export function fromElkGraph(graph: ElkNode): LayoutResult {
  const positions: LayoutResult = new Map();
  for (const child of graph.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return normalizePositions(positions);
}

/** Hierarchical (Sugiyama) layout: referenced tables above or left of the tables that use them. */
export async function layeredLayout(
  input: LayoutInput,
  direction: LayeredDirection,
  createElk: ElkFactory,
): Promise<LayoutResult> {
  if (input.nodes.length === 0) {
    return new Map();
  }
  const elk = createElk();
  const graph = await elk.layout(toElkGraph(input, direction));
  return fromElkGraph(graph);
}
