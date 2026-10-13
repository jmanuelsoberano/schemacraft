import type { LayoutInput, LayoutResult } from "./layoutGraph";
import { adjacency, normalizePositions } from "./layoutGraph";

const RING_STEP = 360;
const MIN_ARC = 300;

/** Breadth-first distance of every reachable node from `focusId`. */
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
  const unreached = input.nodes.map((node) => node.id).filter((id) => !seen.has(id));
  if (unreached.length > 0) {
    rings.push(unreached);
  }
  return rings;
}

/** The most connected node, used as the focus when nothing is selected. */
export function mostConnectedNode(input: LayoutInput): string | null {
  let best: string | null = null;
  let bestDegree = -1;
  for (const [id, neighbours] of adjacency(input)) {
    if (neighbours.size > bestDegree) {
      best = id;
      bestDegree = neighbours.size;
    }
  }
  return best;
}

/** Concentric rings around a focus table, one ring per relationship hop. */
export function radialLayout(input: LayoutInput, focusId: string | null): LayoutResult {
  const focus =
    focusId !== null && input.nodes.some((node) => node.id === focusId)
      ? focusId
      : mostConnectedNode(input);
  if (focus === null) {
    return new Map();
  }
  const sizes = new Map(input.nodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  const rings = ringsFrom(input, focus);
  rings.forEach((ring, level) => {
    const radius =
      level === 0 ? 0 : Math.max(level * RING_STEP, (ring.length * MIN_ARC) / (2 * Math.PI));
    ring.forEach((id, index) => {
      const angle = (2 * Math.PI * index) / ring.length - Math.PI / 2;
      const size = sizes.get(id);
      const width = size?.width ?? 0;
      const height = size?.height ?? 0;
      positions.set(id, {
        x: radius * Math.cos(angle) - width / 2,
        y: radius * Math.sin(angle) - height / 2,
      });
    });
  });
  return normalizePositions(positions);
}
