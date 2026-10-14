import type { SchemaSnapshot } from "@/shared/contracts";

import { entityKey } from "./geometry";

/**
 * Keys of `key` and every entity within `depth` relationship hops of it, in either direction.
 * Depth 1 is the table with its direct parents and children.
 */
export function relatedEntityKeys(
  snapshot: SchemaSnapshot,
  key: string,
  depth: number,
): Set<string> {
  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const set = neighbours.get(from) ?? new Set<string>();
    set.add(to);
    neighbours.set(from, set);
  };
  for (const foreignKey of snapshot.foreignKeys) {
    const source = entityKey(foreignKey.referencingTable);
    const target = entityKey(foreignKey.referencedTable);
    link(source, target);
    link(target, source);
  }

  const reached = new Set<string>([key]);
  let frontier = [key];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbour of neighbours.get(current) ?? []) {
        if (!reached.has(neighbour)) {
          reached.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }
  return reached;
}
