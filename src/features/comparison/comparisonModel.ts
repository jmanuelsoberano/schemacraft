import { ensurePlaced } from "@/features/canvas/canvasState";
import { visibleProjection } from "@/features/export/html/viewerData";
import { renderDiagramSvg } from "@/features/export/svg/renderDiagram";
import type { DiagramLabels } from "@/features/export/svg/renderDiagram";
import type { ExportTheme } from "@/features/export/svg/palette";
import { displayIdentifier, entityKey, qualifiedNameLabel } from "@/features/schema/entities";
import type {
  ComparisonItem,
  ComparisonObjectRef,
  Definition,
  OpenedProject,
  QualifiedName,
  SchemaSnapshot,
} from "@/shared/contracts";

export interface ComparisonInput {
  /** Local only: never copied into the report. */
  path: string;
  document: OpenedProject;
}

export interface ComparisonFilters {
  query: string;
  schema: string;
  kind: string;
  result: string;
}

export const EMPTY_COMPARISON_FILTERS: ComparisonFilters = {
  query: "",
  schema: "",
  kind: "",
  result: "",
};

export function comparisonKey(object: ComparisonObjectRef): string {
  return JSON.stringify([
    object.kind,
    object.name.schema,
    object.name.name,
    object.memberName,
    object.identityArguments,
  ]);
}

export function comparisonObjectLabel(object: ComparisonObjectRef): string {
  const name = qualifiedNameLabel(object.name);
  const member = object.memberName === null ? "" : ` / ${displayIdentifier(object.memberName)}`;
  const argumentsLabel =
    object.identityArguments === null
      ? ""
      : `(${object.identityArguments.map(qualifiedNameLabel).join(", ")})`;
  return `${name}${argumentsLabel}${member}`;
}

export function filteredComparisonItems(
  items: readonly ComparisonItem[],
  filters: ComparisonFilters,
): ComparisonItem[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filters.schema === "" || item.object.name.schema === filters.schema) &&
      (filters.kind === "" || item.object.kind === filters.kind) &&
      (filters.result === "" || item.result === filters.result) &&
      (needle === "" || comparisonObjectLabel(item.object).toLocaleLowerCase().includes(needle)),
  );
}

function sameName(left: QualifiedName, right: QualifiedName): boolean {
  return left.schema === right.schema && left.name === right.name;
}

/** Exact original definition; no code is obtained through a connection or active project. */
export function comparisonDefinition(
  snapshot: SchemaSnapshot,
  object: ComparisonObjectRef,
): Definition | null {
  const code = snapshot.programmability;
  if (!code) return null;
  if (object.kind === "view")
    return code.views.find((view) => sameName(view.view, object.name))?.definition ?? null;
  if (object.kind === "trigger") {
    const body = code.triggers.find(
      (trigger) => sameName(trigger.parent, object.name) && trigger.name === object.memberName,
    )?.body;
    return body?.language === "sql" || body?.language === "postgreSql" ? body.definition : null;
  }
  if (object.kind === "routine") {
    const routine = code.routines.find(
      (routine) =>
        sameName(routine.name, object.name) &&
        JSON.stringify(routine.identityArguments ?? null) ===
          JSON.stringify(object.identityArguments),
    );
    return routine?.body.language === "sql" || routine?.body.language === "postgreSql"
      ? routine.body.definition
      : null;
  }
  return null;
}

export function comparisonSource(
  snapshot: SchemaSnapshot,
  object: ComparisonObjectRef,
): string | null {
  const definition = comparisonDefinition(snapshot, object);
  return definition?.status === "readable" ? definition.text : null;
}

/** A contextual diagram is a new value; it never mounts or writes the active canvas store. */
export function comparisonContextSvg(
  input: ComparisonInput,
  objects: readonly ComparisonObjectRef[],
  labels: DiagramLabels,
  theme: ExportTheme,
  /** Localized context/side label; database and connection names cannot enter this title. */
  title: string,
  includeNeighbors = false,
): string | null {
  const { snapshot, canvas } = input.document.project;
  const keys = new Set(
    objects
      .filter(
        (object) =>
          object.kind === "table" ||
          object.kind === "view" ||
          (includeNeighbors && (object.kind === "trigger" || object.kind === "foreignKey")),
      )
      .map((object) => entityKey(object.name)),
  );
  if (keys.size === 0) return null;
  if (includeNeighbors && !canvas.nodes.some((node) => keys.has(entityKey(node.name)))) return null;
  const included = new Set(keys);
  if (includeNeighbors) {
    for (const key of snapshot.foreignKeys) {
      if (keys.has(entityKey(key.referencingTable)) || keys.has(entityKey(key.referencedTable))) {
        included.add(entityKey(key.referencingTable));
        included.add(entityKey(key.referencedTable));
      }
    }
  }
  const placed = ensurePlaced(canvas, snapshot);
  const selected = {
    ...placed,
    nodes: placed.nodes.map((node) => ({ ...node, isHidden: !included.has(entityKey(node.name)) })),
  };
  const projected = visibleProjection(snapshot, selected);
  if (projected.snapshot.tables.length + projected.snapshot.views.length === 0) return null;
  return renderDiagramSvg(
    { snapshot: projected.snapshot, canvas: projected.canvas },
    { detailLevel: "keys", theme, labels, title },
  ).svg;
}
