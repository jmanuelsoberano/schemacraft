import type { ELK } from "elkjs/lib/elk-api";

import { useProjectStore } from "@/features/project/projectStore";

import { withCollapsed, withHidden, withLayout, withOnlyVisible } from "./canvasState";
import { useCanvasUiStore } from "./canvasUiStore";
import { describeEntities, entityKey } from "./geometry";
import { visibleEntityKeys } from "./graph";
import { buildLayoutInput, runLayout } from "./layouts";
import type { LayoutRequest } from "./layouts";
import { createElkInWorker } from "./layouts/elkWorker";
import { relatedEntityKeys } from "./neighborhood";

/**
 * Operations on the open project's diagram, shared by the action registry, the context menus
 * and the command palette. Every change goes through the project store, so it is undoable
 * and marks the project as unsaved.
 */

let elkInstance: ELK | null = null;

/** One ELK worker for the lifetime of the window. */
function elk(): ELK {
  elkInstance ??= createElkInWorker();
  return elkInstance;
}

/** Runs a layout over the visible entities and fits them into view. */
export async function applyLayout(request: LayoutRequest): Promise<void> {
  const { project, updateCanvas } = useProjectStore.getState();
  const ui = useCanvasUiStore.getState();
  if (project === null || ui.isLayoutRunning) {
    return;
  }
  const { snapshot, canvas } = project.content;
  const entities = describeEntities(snapshot);
  const visible = visibleEntityKeys(entities, canvas.nodes);
  const collapsed = new Set(
    canvas.nodes.filter((node) => node.isCollapsed).map((node) => entityKey(node.name)),
  );
  const positions = new Map(canvas.nodes.map((node) => [entityKey(node.name), node.position]));
  const input = buildLayoutInput(
    snapshot,
    entities,
    visible,
    canvas.detailLevel,
    collapsed,
    positions,
  );

  ui.setLayoutRunning(true);
  ui.setLastLayout(request);
  try {
    const result = await runLayout(request, input, elk);
    updateCanvas((current) => withLayout(current, result, request.kind));
    useCanvasUiStore.getState().requestFit();
  } finally {
    useCanvasUiStore.getState().setLayoutRunning(false);
  }
}

/** Repeats the last layout the user chose (hierarchical top-down the first time). */
export function applyLastLayout(): Promise<void> {
  return applyLayout(useCanvasUiStore.getState().lastLayout);
}

/** Lays out a fresh project once, without touching the undo history or the dirty flag. */
export async function layoutFreshProject(): Promise<void> {
  const { project } = useProjectStore.getState();
  if (project === null) {
    return;
  }
  const { snapshot, canvas } = project.content;
  const entities = describeEntities(snapshot);
  const visible = visibleEntityKeys(entities, canvas.nodes);
  const positions = new Map(canvas.nodes.map((node) => [entityKey(node.name), node.position]));
  const input = buildLayoutInput(
    snapshot,
    entities,
    visible,
    canvas.detailLevel,
    new Set(),
    positions,
  );
  const result = await runLayout({ kind: "layered", direction: "down" }, input, elk);
  useProjectStore.getState().updateCanvas((current) => withLayout(current, result, "layered"), {
    undoable: false,
    dirty: false,
  });
  useCanvasUiStore.getState().requestFit();
}

/** Keeps only `key` and the entities within `depth` relationship hops of it. */
export function isolateEntity(key: string, depth: number): void {
  const { project, updateCanvas } = useProjectStore.getState();
  if (project === null) {
    return;
  }
  const related = relatedEntityKeys(project.content.snapshot, key, depth);
  updateCanvas((canvas) => withOnlyVisible(canvas, related));
  useCanvasUiStore.getState().requestFit();
}

export function hideEntities(keys: readonly string[]): void {
  useProjectStore.getState().updateCanvas((canvas) => withHidden(canvas, keys, true));
}

export function showAllEntities(): void {
  const { project, updateCanvas } = useProjectStore.getState();
  if (project === null) {
    return;
  }
  updateCanvas((canvas) =>
    withHidden(
      canvas,
      canvas.nodes.map((node) => entityKey(node.name)),
      false,
    ),
  );
  useCanvasUiStore.getState().requestFit();
}

export function setCollapsedForAll(isCollapsed: boolean): void {
  useProjectStore.getState().updateCanvas((canvas) =>
    withCollapsed(
      canvas,
      canvas.nodes.map((node) => entityKey(node.name)),
      isCollapsed,
    ),
  );
}

export function setCollapsed(keys: readonly string[], isCollapsed: boolean): void {
  useProjectStore.getState().updateCanvas((canvas) => withCollapsed(canvas, keys, isCollapsed));
}
