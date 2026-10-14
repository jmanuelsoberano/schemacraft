import type { Point } from "@/shared/contracts";

import type { LayoutInput, LayoutNode, LayoutResult } from "./layoutGraph";
import { adjacency, detachedNodeIds, normalizePositions, placeDetachedBelow } from "./layoutGraph";

const RING_STEP = 360;
const MIN_ARC = 300;
const COMPONENT_GAP = 160;
const TOP = -Math.PI / 2;

/** Breadth-first rings of the nodes reachable from `focusId`, the focus alone in the first. */
export function ringsFrom(input: LayoutInput, focusId: string): string[][] {
  const neighbours = adjacency(input);
  const seen = new Set<string>([focusId]);
  const rings: string[][] = [[focusId]];
  let frontier = [focusId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of [...(neighbours.get(id) ?? [])].sort()) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    if (next.length > 0) {
      rings.push(next);
    }
    frontier = next;
  }
  return rings;
}

/** The most connected node, among `candidates` when given; the focus when nothing is selected. */
export function mostConnectedNode(
  input: LayoutInput,
  candidates?: ReadonlySet<string>,
): string | null {
  let best: string | null = null;
  let bestDegree = -1;
  for (const [id, neighbours] of adjacency(input)) {
    if (candidates !== undefined && !candidates.has(id)) {
      continue;
    }
    if (neighbours.size > bestDegree) {
      best = id;
      bestDegree = neighbours.size;
    }
  }
  return best;
}

/**
 * Rings of one connected component around `focus`, centred on the origin. Each node sits in
 * the direction of the node it was reached from, so chains radiate outwards instead of piling up.
 */
function ringPositions(
  input: LayoutInput,
  sizes: ReadonlyMap<string, LayoutNode>,
  focus: string,
): Map<string, Point> {
  const neighbours = adjacency(input);
  const angles = new Map<string, number>([[focus, TOP]]);
  const positions = new Map<string, Point>();
  const place = (id: string, radius: number, angle: number) => {
    const size = sizes.get(id);
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    angles.set(id, angle);
    positions.set(id, {
      x: radius * Math.cos(angle) - width / 2,
      y: radius * Math.sin(angle) - height / 2,
    });
  };

  const rings = ringsFrom(input, focus);
  rings.forEach((ring, level) => {
    if (level === 0) {
      place(focus, 0, TOP);
      return;
    }
    const previous = new Set(rings[level - 1] ?? []);
    const entries = ring
      .map((id) => {
        const parent = [...(neighbours.get(id) ?? [])].find((candidate) => previous.has(candidate));
        return { id, parentAngle: parent === undefined ? TOP : (angles.get(parent) ?? TOP) };
      })
      .sort((left, right) => left.parentAngle - right.parentAngle);
    const radius = Math.max(level * RING_STEP, (ring.length * MIN_ARC) / (2 * Math.PI));
    const start = entries[0]?.parentAngle ?? TOP;
    const step = (2 * Math.PI) / ring.length;
    entries.forEach((entry, index) => {
      place(entry.id, radius, ring.length === 1 ? entry.parentAngle : start + index * step);
    });
  });
  return positions;
}

/**
 * Concentric rings around a focus table, one ring per relationship hop. Other connected
 * components get their own rings, side by side; tables without relationships go in a block
 * below the diagram.
 */
export function radialLayout(input: LayoutInput, focusId: string | null): LayoutResult {
  const sizes = new Map(input.nodes.map((node) => [node.id, node]));
  const detached = detachedNodeIds(input);
  const remaining = new Set(input.nodes.map((node) => node.id));
  for (const id of detached) {
    remaining.delete(id);
  }
  const positions = new Map<string, Point>();
  let offsetX = 0;
  let focus =
    focusId !== null && remaining.has(focusId) ? focusId : mostConnectedNode(input, remaining);
  while (focus !== null) {
    const component = ringPositions(input, sizes, focus);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const [id, point] of component) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x + (sizes.get(id)?.width ?? 0));
    }
    for (const [id, point] of component) {
      positions.set(id, { x: point.x - minX + offsetX, y: point.y - minY });
      remaining.delete(id);
    }
    offsetX += maxX - minX + COMPONENT_GAP;
    focus = mostConnectedNode(input, remaining);
  }
  return normalizePositions(placeDetachedBelow(positions, input, detached));
}
