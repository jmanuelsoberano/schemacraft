import type { Point } from "@/shared/contracts";

import type { LayoutInput } from "./layoutGraph";
import { adjacency } from "./layoutGraph";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 60;

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    b.x < a.x + a.width + GAP &&
    a.y < b.y + b.height + GAP &&
    b.y < a.y + a.height + GAP
  );
}

function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) {
    return null;
  }
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Positions for entities that have none yet (for example tables added by a refresh): next to
 * the tables they relate to, in the first free spot to the right, below, left or above; or in a
 * row under the whole diagram when they relate to nothing. Placed entities never move.
 */
export function placeNearRelated(
  input: LayoutInput,
  unplaced: readonly string[],
): Map<string, Point> {
  const sizes = new Map(input.nodes.map((node) => [node.id, node]));
  const placed = new Map<string, Box>();
  for (const [id, point] of input.positions) {
    const size = sizes.get(id);
    if (size !== undefined && !unplaced.includes(id)) {
      placed.set(id, { x: point.x, y: point.y, width: size.width, height: size.height });
    }
  }
  const neighbours = adjacency(input);
  const result = new Map<string, Point>();
  let orphanX: number | null = null;
  let orphanY = 0;

  const isFree = (candidate: Box) => [...placed.values()].every((box) => !overlaps(candidate, box));

  for (const id of unplaced) {
    const size = sizes.get(id);
    if (size === undefined) {
      continue;
    }
    const related = [...(neighbours.get(id) ?? [])]
      .map((neighbour) => placed.get(neighbour))
      .filter((box): box is Box => box !== undefined);
    const anchor = union(related);
    let spot: Box | null = null;

    if (anchor !== null) {
      const candidates: Box[] = [
        { x: anchor.x + anchor.width + GAP, y: anchor.y, width: size.width, height: size.height },
        { x: anchor.x, y: anchor.y + anchor.height + GAP, width: size.width, height: size.height },
        { x: anchor.x - size.width - GAP, y: anchor.y, width: size.width, height: size.height },
        { x: anchor.x, y: anchor.y - size.height - GAP, width: size.width, height: size.height },
      ];
      // Slide along the chosen side until the spot is free.
      for (const candidate of candidates) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const shifted = { ...candidate, y: candidate.y + attempt * (size.height + GAP) };
          if (isFree(shifted)) {
            spot = shifted;
            break;
          }
        }
        if (spot !== null) {
          break;
        }
      }
    }

    if (spot === null) {
      const everything = union([...placed.values()]);
      if (orphanX === null) {
        orphanX = everything?.x ?? 0;
        orphanY = everything === null ? 0 : everything.y + everything.height + GAP * 2;
      }
      spot = { x: orphanX, y: orphanY, width: size.width, height: size.height };
      orphanX += size.width + GAP;
    }

    placed.set(id, spot);
    result.set(id, { x: spot.x, y: spot.y });
  }
  return result;
}
