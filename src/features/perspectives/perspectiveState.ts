import { ensurePlaced } from "@/features/canvas/canvasState";
import { entityKey, qualifiedNameLabel } from "@/features/schema/entities";
import type { CanvasState, ProjectContent, SchemaSnapshot } from "@/shared/contracts";
import type { NoteTarget } from "@/shared/contracts/generated/project/NoteTarget";
import type { ProjectAnnotations } from "@/shared/contracts/generated/project/ProjectAnnotations";
import type { ProjectNote } from "@/shared/contracts/generated/project/ProjectNote";
import type { SavedPerspective } from "@/shared/contracts/generated/project/SavedPerspective";

/** Only editable map/documentation values; snapshot and connection never enter undo history. */
export interface DiagramWorkspace {
  canvas: CanvasState;
  perspectives?: SavedPerspective[];
  annotations?: ProjectAnnotations;
  activePerspectiveId?: string;
}

export function activePerspective(content: ProjectContent): SavedPerspective | undefined {
  return content.perspectives?.find((item) => item.id === content.activePerspectiveId);
}

export function activeCanvas(content: ProjectContent): CanvasState {
  return activePerspective(content)?.canvas ?? content.canvas;
}

export function workspaceOf(content: ProjectContent): DiagramWorkspace {
  return {
    canvas: content.canvas,
    ...(content.perspectives === undefined ? {} : { perspectives: content.perspectives }),
    ...(content.annotations === undefined ? {} : { annotations: content.annotations }),
    ...(content.activePerspectiveId === undefined
      ? {}
      : { activePerspectiveId: content.activePerspectiveId }),
  };
}

/** Replaces optional values too; undoing creation must not leave the new maps behind. */
export function withWorkspace(
  content: ProjectContent,
  workspace: DiagramWorkspace,
): ProjectContent {
  const rest = { ...content };
  delete rest.perspectives;
  delete rest.annotations;
  delete rest.activePerspectiveId;
  return { ...rest, ...workspace };
}

export function withActiveCanvas(content: ProjectContent, canvas: CanvasState): ProjectContent {
  const perspective = activePerspective(content);
  return perspective === undefined
    ? { ...content, canvas }
    : {
        ...content,
        perspectives: content.perspectives?.map((item) =>
          item.id === perspective.id ? { ...item, canvas } : item,
        ),
      };
}

/** Missing entries in a curated map never enlarge its selection. */
export function ensurePerspectivePlaced(
  canvas: CanvasState,
  snapshot: SchemaSnapshot,
): CanvasState {
  const previous = new Set(canvas.nodes.map((node) => entityKey(node.name)));
  const placed = ensurePlaced(canvas, snapshot);
  return placed === canvas
    ? canvas
    : {
        ...placed,
        nodes: placed.nodes.map((node) =>
          previous.has(entityKey(node.name)) ? node : { ...node, isHidden: true },
        ),
      };
}

export function noteTargetKey(target: NoteTarget): string {
  return JSON.stringify(
    target.kind === "table"
      ? [target.kind, target.table.schema, target.table.name]
      : [target.kind, target.table.schema, target.table.name, target.column],
  );
}

export function noteTargetExists(target: NoteTarget, snapshot: SchemaSnapshot): boolean {
  const table = snapshot.tables.find((item) => entityKey(item.name) === entityKey(target.table));
  return (
    table !== undefined &&
    (target.kind === "table" || table.columns.some((column) => column.name === target.column))
  );
}

/** No automatic reassignment, including after an old name reappears. */
export function reconcileAnnotations(
  annotations: ProjectAnnotations | undefined,
  snapshot: SchemaSnapshot,
): ProjectAnnotations | undefined {
  if (annotations === undefined) return undefined;
  return {
    ...annotations,
    notes: annotations.notes.map((note) =>
      note.isLinked && !noteTargetExists(note.target, snapshot)
        ? { ...note, isLinked: false }
        : note,
    ),
  };
}

export function linkedNote(content: ProjectContent, target: NoteTarget): ProjectNote | undefined {
  const key = noteTargetKey(target);
  return content.annotations?.notes.find(
    (note) => note.isLinked && noteTargetKey(note.target) === key,
  );
}

export function noteTargetLabel(target: NoteTarget): string {
  const table = qualifiedNameLabel(target.table);
  return target.kind === "table" ? table : `${table} · ${target.column}`;
}

export function exportableNotes(content: ProjectContent, canvas: CanvasState): ProjectNote[] {
  const visible = new Set(
    canvas.nodes.filter((node) => !node.isHidden).map((node) => entityKey(node.name)),
  );
  return (content.annotations?.notes ?? []).filter(
    (note) =>
      note.isLinked &&
      visible.has(entityKey(note.target.table)) &&
      noteTargetExists(note.target, content.snapshot),
  );
}

/** Whitelisted text only: identifiers select notes locally but their stored IDs never travel. */
export interface ExportedAnnotations {
  description: string | null;
  notes: { target: NoteTarget; text: string }[];
}

export function projectExportAnnotations(
  content: ProjectContent,
  canvas: CanvasState,
  includeDescription: boolean,
  selectedNoteIds: ReadonlySet<string>,
): ExportedAnnotations {
  const visible = new Set(
    canvas.nodes.filter((node) => !node.isHidden).map((node) => entityKey(node.name)),
  );
  return {
    description: includeDescription ? (activePerspective(content)?.description ?? null) : null,
    notes: (content.annotations?.notes ?? [])
      .filter(
        (note) =>
          note.isLinked &&
          selectedNoteIds.has(note.id) &&
          visible.has(entityKey(note.target.table)) &&
          noteTargetExists(note.target, content.snapshot),
      )
      .map((note) => ({
        target:
          note.target.kind === "table"
            ? {
                kind: "table",
                table: { schema: note.target.table.schema, name: note.target.table.name },
              }
            : {
                kind: "column",
                table: { schema: note.target.table.schema, name: note.target.table.name },
                column: note.target.column,
              },
        text: note.text,
      })),
  };
}
