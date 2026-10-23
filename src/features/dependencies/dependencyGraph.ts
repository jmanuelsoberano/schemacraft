import type { DependencyObjectRef } from "@/shared/contracts/generated/model/DependencyObjectRef";
import type { DependencySnapshot } from "@/shared/contracts/generated/model/DependencySnapshot";
import type { SchemaSnapshot, NotReadReason, DatabaseProvider } from "@/shared/contracts";
import { qualifiedNameLabel } from "@/features/schema/entities";
import type { RoutineTrackingState } from "@/features/schema/routineDependencyTracking";

export type DependencyDirection = "outgoing" | "incoming" | "both";

/** Projection used by the graph and its exporters: no snapshot, module body or raw reference. */
export interface DependencyNode {
  id: string;
  object: DependencyObjectRef | null;
  label: string;
  kind: "table" | "view" | "routine" | "trigger" | "reference";
  status: string;
  readAt: string | null;
  retained: boolean;
  /** PostgreSQL routine-body evidence, separate from catalog-list and runtime completeness. */
  routineBodyTracking?: RoutineTrackingState;
}
export interface DependencyGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  retained: boolean;
}
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyGraphEdge[];
  capture: string;
  /** Closed read outcome, never a driver message; null when the capture was read/unrecorded. */
  captureReason: NotReadReason | null;
  limitations: string[];
  omitted: number;
  /** Exploration hit its scheduling budget; omitted is then a proven lower bound. */
  discoveryIncomplete: boolean;
}

export function dependencyObjectKey(object: DependencyObjectRef): string {
  switch (object.kind) {
    case "table":
    case "view":
      return JSON.stringify([object.kind, object.name.schema, object.name.name]);
    case "routine":
      return JSON.stringify([
        object.kind,
        object.name.schema,
        object.name.name,
        object.identityArguments ?? null,
      ]);
    case "trigger":
      return JSON.stringify([object.kind, object.parent.schema, object.parent.name, object.name]);
  }
}

export function dependencyObjectLabel(object: DependencyObjectRef): string {
  if (object.kind === "trigger") return `${qualifiedNameLabel(object.parent)} · ${object.name}`;
  const name = qualifiedNameLabel(object.name);
  return object.kind === "routine" && object.identityArguments != null
    ? `${name}(${object.identityArguments.map(qualifiedNameLabel).join(", ")})`
    : name;
}

export function dependencyObjects(snapshot: SchemaSnapshot): DependencyObjectRef[] {
  return [
    ...snapshot.tables.map((table): DependencyObjectRef => ({ kind: "table", name: table.name })),
    ...snapshot.views.map((view): DependencyObjectRef => ({ kind: "view", name: view.name })),
    ...(snapshot.programmability?.routines ?? []).map((routine): DependencyObjectRef => ({
      kind: "routine",
      name: routine.name,
      identityArguments: routine.identityArguments,
    })),
    ...(snapshot.programmability?.triggers ?? []).map((trigger): DependencyObjectRef => ({
      kind: "trigger",
      parent: trigger.parent,
      name: trigger.name,
    })),
  ].sort(
    (left, right) =>
      dependencyObjectLabel(left).localeCompare(dependencyObjectLabel(right)) ||
      dependencyObjectKey(left).localeCompare(dependencyObjectKey(right)),
  );
}

/** Fresh closed objects deliberately prevent unknown extension keys from entering an export. */
function projectObject(object: DependencyObjectRef): DependencyObjectRef {
  const name = (value: { schema: string; name: string }) => ({
    schema: value.schema,
    name: value.name,
  });
  switch (object.kind) {
    case "table":
    case "view":
      return { kind: object.kind, name: name(object.name) };
    case "routine":
      return {
        kind: "routine",
        name: name(object.name),
        ...(object.identityArguments === undefined
          ? {}
          : { identityArguments: object.identityArguments.map(name) }),
      };
    case "trigger":
      return { kind: "trigger", parent: name(object.parent), name: object.name };
  }
}

export function projectDependencyGraph(
  family: DependencySnapshot | undefined,
  objects: readonly DependencyObjectRef[],
  provider?: DatabaseProvider,
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const sources = new Map(
    (family?.sources ?? []).map((source) => [dependencyObjectKey(source.object), source]),
  );
  for (const object of objects) {
    const source = sources.get(dependencyObjectKey(object));
    nodes.set(dependencyObjectKey(object), {
      id: dependencyObjectKey(object),
      object: projectObject(object),
      label: dependencyObjectLabel(object),
      kind: object.kind,
      status: source?.coverage ?? "notRecorded",
      readAt: source?.readAt ?? null,
      retained: source?.retained ?? false,
      ...(object.kind === "routine" &&
      (provider === "postgreSql" ||
        (provider === undefined && object.identityArguments !== undefined))
        ? { routineBodyTracking: source?.routineBodyTracking ?? "notRecorded" }
        : {}),
    });
  }
  const edges: DependencyGraphEdge[] = [];
  for (const [index, edge] of (family?.edges ?? []).entries()) {
    const source = dependencyObjectKey(edge.source);
    if (!nodes.has(source)) continue;
    let target: string;
    if (edge.target.kind === "object") {
      target = dependencyObjectKey(edge.target.object);
      if (!nodes.has(target)) continue;
    } else {
      // Opaque ordinal: raw reference fields (including server/database identifiers) stay local.
      target = `reference-${index}`;
      const label =
        edge.target.schema == null
          ? (edge.target.name ?? "?")
          : qualifiedNameLabel({ schema: edge.target.schema, name: edge.target.name ?? "?" });
      nodes.set(target, {
        id: target,
        object: null,
        label,
        kind: "reference",
        status: edge.target.status,
        readAt: edge.readAt,
        retained: edge.retained,
      });
    }
    edges.push({ id: `edge-${index}`, source, target, kind: edge.kind, retained: edge.retained });
  }
  return {
    nodes: [...nodes.values()],
    edges,
    capture: family?.capture.status ?? "notRecorded",
    captureReason: family?.capture.status === "notRead" ? family.capture.reason : null,
    limitations: [...(family?.limitations ?? [])],
    omitted: 0,
    discoveryIncomplete: false,
  };
}

/**
 * Cycle-safe traversal with at most 500 scheduled nodes, including hidden intermediates.
 * Depth zero means known reachable paths within that explicit computation budget. The extra
 * bounded set counts distinct omitted frontier nodes; unexpanded descendants remain unknown,
 * so truncated output reports a lower bound instead of an invented exact reachable count.
 */
export function exploreDependencies(
  graph: DependencyGraph,
  root: string,
  direction: DependencyDirection,
  depth: number,
  hidden: ReadonlySet<string> = new Set(),
  limit = 500,
): DependencyGraph {
  const budget = Math.min(500, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 500));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const discovered = new Set<string>();
  const omittedFrontier = new Set<string>();
  const queue: { id: string; depth: number }[] = [];
  let discoveryIncomplete = false;
  if (nodeIds.has(root)) {
    if (budget > 0) {
      discovered.add(root);
      queue.push({ id: root, depth: 0 });
    } else {
      discoveryIncomplete = true;
      if (!hidden.has(root)) omittedFrontier.add(root);
    }
  }
  const adjacency = new Map<string, string[]>();
  const connect = (source: string, target: string) => {
    const neighbors = adjacency.get(source);
    if (neighbors === undefined) adjacency.set(source, [target]);
    else neighbors.push(target);
  };
  for (const edge of graph.edges) {
    if (direction !== "incoming") connect(edge.source, edge.target);
    if (direction !== "outgoing") connect(edge.target, edge.source);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current === undefined) continue;
    if (depth > 0 && current.depth >= depth) continue;
    for (const id of adjacency.get(current.id) ?? []) {
      if (discovered.has(id) || !nodeIds.has(id)) continue;
      if (discovered.size >= budget) {
        discoveryIncomplete = true;
        if (!hidden.has(id) && omittedFrontier.size < Math.max(1, budget)) omittedFrontier.add(id);
        continue;
      }
      discovered.add(id);
      queue.push({ id, depth: current.depth + 1 });
    }
  }
  const nodes = graph.nodes.filter((node) => discovered.has(node.id) && !hidden.has(node.id));
  const included = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
    capture: graph.capture,
    captureReason: graph.captureReason,
    limitations: [...graph.limitations],
    omitted: omittedFrontier.size,
    discoveryIncomplete,
  };
}
