import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

import type { LayoutInput, LayoutResult } from "./layoutGraph";
import { detachedNodeIds, normalizePositions, placeDetachedBelow } from "./layoutGraph";

interface BodyNode extends SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
}

const TICKS = 300;
const LINK_DISTANCE = 300;
const CHARGE = -1600;
/** Beyond this distance tables stop repelling, so separate clusters do not drift apart. */
const CHARGE_RANGE = 900;

/** Deterministic pseudo-random source, so the same input always yields the same layout. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Force-directed layout: linked tables attract, every table repels, boxes never overlap. The
 * simulation starts from the current positions so related tables stay in their region; tables
 * without relationships stay out of it and go in a block below the diagram.
 */
export function organicLayout(input: LayoutInput): LayoutResult {
  if (input.nodes.length === 0) {
    return new Map();
  }
  const detached = detachedNodeIds(input);
  const detachedSet = new Set(detached);
  const bodies: BodyNode[] = input.nodes
    .filter((node) => !detachedSet.has(node.id))
    .map((node) => {
      const current = input.positions.get(node.id);
      return {
        id: node.id,
        width: node.width,
        height: node.height,
        x: current === undefined ? undefined : current.x + node.width / 2,
        y: current === undefined ? undefined : current.y + node.height / 2,
      };
    });
  const byId = new Map(bodies.map((body) => [body.id, body]));
  const links: SimulationLinkDatum<BodyNode>[] = input.edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  if (bodies.length > 0) {
    const simulation = forceSimulation<BodyNode>(bodies)
      .randomSource(seededRandom(42))
      .force(
        "link",
        forceLink<BodyNode, SimulationLinkDatum<BodyNode>>(links)
          .id((body) => body.id)
          .distance(LINK_DISTANCE)
          .strength(0.6),
      )
      .force("charge", forceManyBody<BodyNode>().strength(CHARGE).distanceMax(CHARGE_RANGE))
      .force(
        "collide",
        forceCollide<BodyNode>()
          .radius((body) => Math.hypot(body.width, body.height) / 2 + 24)
          .iterations(2),
      )
      .force("center", forceCenter(0, 0))
      .stop();
    simulation.tick(TICKS);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const body of bodies) {
    positions.set(body.id, {
      x: (body.x ?? 0) - body.width / 2,
      y: (body.y ?? 0) - body.height / 2,
    });
  }
  return normalizePositions(placeDetachedBelow(positions, input, detached));
}
