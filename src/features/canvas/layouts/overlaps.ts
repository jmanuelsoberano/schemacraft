import type { Point } from "@/shared/contracts";

/** A node box with its id, as the overlap resolver sees it. */
export interface PlacedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Vertical room kept between a box and the one pushed below it. */
export const OVERLAP_GAP = 24;

/**
 * Keeps boxes apart by moving them down, never up or sideways: boxes are visited from top to
 * bottom and each one slides below the lowest box it would overlap among those already placed.
 * Columns of a layered layout therefore stay columns, and nothing changes when nothing overlaps.
 */
export function resolveOverlaps(
  boxes: readonly PlacedBox[],
  gap: number = OVERLAP_GAP,
): Map<string, Point> {
  const ordered = [...boxes].sort((left, right) => left.y - right.y || left.x - right.x);
  const placed: PlacedBox[] = [];
  const result = new Map<string, Point>();
  for (const box of ordered) {
    let y = box.y;
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of placed) {
        const sideBySide = box.x >= other.x + other.width || other.x >= box.x + box.width;
        const apart = y >= other.y + other.height + gap || other.y >= y + box.height + gap;
        if (!sideBySide && !apart) {
          y = other.y + other.height + gap;
          moved = true;
        }
      }
    }
    placed.push({ ...box, y });
    result.set(box.id, { x: box.x, y });
  }
  return result;
}
