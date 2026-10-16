import { getSmoothStepPath } from "@xyflow/system";

import { LOOP_REACH, relationAnchors, selfLoopPath } from "@/features/canvas/edgeGeometry";
import type { NodeBox } from "@/features/canvas/edgeGeometry";
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  attachmentY,
  describeEntities,
  entityKey,
  nodeHeight,
  rowCenterY,
  rowsFor,
} from "@/features/canvas/geometry";
import type { ColumnRow, EntityDescriptor } from "@/features/canvas/geometry";
import {
  gridPosition,
  isOptionalForeignKey,
  nodeStatesByKey,
  relationEdgeId,
} from "@/features/canvas/graph";
import { formatDataType } from "@/features/schema/dataType";
import type { CanvasState, DetailLevel, ForeignKey, SchemaSnapshot } from "@/shared/contracts";

import { ICON_KEY, ICON_LINK, ICON_SYMBOLS, ICON_TABLE, ICON_VIEW } from "./icons";
import { DIAGRAM_PALETTES } from "./palette";
import type { DiagramPalette, ExportTheme } from "./palette";
import {
  MONO_FONT_STACK,
  SANS_FONT_STACK,
  coordinate,
  escapeXml,
  estimateTextWidth,
  fitText,
} from "./text";
import type { TextFont, TextMeasurer } from "./text";

/** The diagram to draw: the schema and the state of its canvas. */
export interface DiagramInput {
  snapshot: SchemaSnapshot;
  canvas: CanvasState;
}

export interface RenderOptions {
  detailLevel: DetailLevel;
  theme: ExportTheme;
  /** CSS placed before the diagram rules, typically `@font-face` declarations. */
  fontFaces?: string;
  /** Whether to paint the canvas colour behind the diagram; `true` by default. */
  background?: boolean;
  /** Empty space around the diagram, in CSS pixels. */
  padding?: number;
  /** Text measurer of the environment; a width estimate is used without one. */
  measureText?: TextMeasurer;
  /** `<title>` of the document, the database name by default. */
  title?: string;
  /** `<desc>` of the document, for example the export date. */
  description?: string;
  /**
   * One line under the diagram, bottom left, such as the note that the schema was read with
   * partial access. The document grows to make room for it.
   */
  footnote?: string;
}

/** What sizes the document besides the diagram, as {@link renderDiagramSvg} will draw it. */
export type MeasureOptions = Pick<RenderOptions, "padding" | "footnote">;

export interface DiagramExtent {
  /** Width in CSS pixels, padding included. */
  width: number;
  /** Height in CSS pixels, padding included. */
  height: number;
  entityCount: number;
  relationCount: number;
}

export interface RenderedDiagram extends DiagramExtent {
  svg: string;
}

export const DEFAULT_PADDING = 48;

/** Marker ids; the `-active` ones are the accent-coloured variants the HTML viewer switches to. */
export const MARKER_MANY = "sc-many";
export const MARKER_MANY_OPTIONAL = "sc-many-optional";
export const MARKER_ONE = "sc-one";
export const ACTIVE_SUFFIX = "-active";

const HEADER_PADDING_LEFT = 10;
const HEADER_PADDING_RIGHT = 8;
const ICON_SIZE = 14;
const ROLE_ICON_SIZE = 12;
const ROLE_WIDTH = 26;
const ROW_PADDING = 10;
const GAP = 6;
const TYPE_MAX_WIDTH = 110;
const PILL_HEIGHT = 16;
const PILL_PADDING = 6;
const CORNER_RADIUS = 10;
/** Space between the lowest node and the footnote, and the height of the footnote line. */
const FOOTNOTE_GAP = 16;
const FOOTNOTE_LINE_HEIGHT = 16;

const TITLE_FONT: TextFont = { family: "mono", size: 12, weight: 400 };
const NAME_FONT: TextFont = { family: "mono", size: 12, weight: 600 };
const COUNT_FONT: TextFont = { family: "sans", size: 10, weight: 600 };
const COLUMN_FONT: TextFont = { family: "sans", size: 12, weight: 400 };
const TYPE_FONT: TextFont = { family: "mono", size: 11, weight: 400 };
const FOOTNOTE_FONT: TextFont = { family: "sans", size: 11, weight: 400 };

interface PlacedEntity {
  entity: EntityDescriptor;
  rows: ColumnRow[];
  box: NodeBox;
}

interface PlacedFootnote {
  text: string;
  /** Start of the baseline. */
  x: number;
  y: number;
}

interface Layout {
  placed: PlacedEntity[];
  relations: ForeignKey[];
  footnote: PlacedFootnote | null;
  extent: DiagramExtent;
}

/** Vertical position of a baseline that centres text of `size` on `centerY`. */
function baseline(centerY: number, size: number): number {
  return centerY + size * 0.35;
}

function layoutDiagram(
  input: DiagramInput,
  detailLevel: DetailLevel,
  padding: number,
  footnote: string | undefined,
): Layout {
  const entities = describeEntities(input.snapshot);
  const states = nodeStatesByKey(input.canvas.nodes);
  const placed: PlacedEntity[] = [];
  let unplaced = 0;
  for (const entity of entities.values()) {
    const state = states.get(entity.key);
    if (state?.isHidden === true) {
      continue;
    }
    const position = state?.position ?? gridPosition(unplaced);
    if (state === undefined) {
      unplaced += 1;
    }
    const rows = rowsFor(entity, detailLevel, state?.isCollapsed ?? false);
    placed.push({
      entity,
      rows,
      box: { x: position.x, y: position.y, width: NODE_WIDTH, height: nodeHeight(rows.length) },
    });
  }

  const visible = new Set(placed.map((item) => item.entity.key));
  const relations = input.snapshot.foreignKeys.filter(
    (key) =>
      visible.has(entityKey(key.referencingTable)) && visible.has(entityKey(key.referencedTable)),
  );
  const hasSelfReference = relations.some(
    (key) => entityKey(key.referencingTable) === entityKey(key.referencedTable),
  );

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { box } of placed) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width + (hasSelfReference ? LOOP_REACH + 4 : 0));
    maxY = Math.max(maxY, box.y + box.height);
  }
  if (placed.length === 0) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  for (const item of placed) {
    item.box = { ...item.box, x: item.box.x - minX + padding, y: item.box.y - minY + padding };
  }

  let width = Math.ceil(maxX - minX + padding * 2);
  let height = Math.ceil(maxY - minY + padding * 2);
  let placedFootnote: PlacedFootnote | null = null;
  if (footnote !== undefined && footnote !== "") {
    const top = maxY - minY + padding + FOOTNOTE_GAP;
    placedFootnote = {
      text: footnote,
      x: padding,
      y: baseline(top + FOOTNOTE_LINE_HEIGHT / 2, FOOTNOTE_FONT.size),
    };
    // Sized with the estimate, which runs wider than the fonts for prose, so that measuring
    // without a text measurer and drawing with one agree and the line always fits.
    width = Math.max(width, Math.ceil(estimateTextWidth(footnote, FOOTNOTE_FONT) + padding * 2));
    height = Math.ceil(top + FOOTNOTE_LINE_HEIGHT + padding);
  }
  return {
    placed,
    relations,
    footnote: placedFootnote,
    extent: {
      width,
      height,
      entityCount: placed.length,
      relationCount: relations.length,
    },
  };
}

/** Size and counts of the diagram as it would be exported, without drawing it. */
export function measureDiagram(
  input: DiagramInput,
  detailLevel: DetailLevel,
  options: MeasureOptions = {},
): DiagramExtent {
  return layoutDiagram(input, detailLevel, options.padding ?? DEFAULT_PADDING, options.footnote)
    .extent;
}

function styles(palette: DiagramPalette, fontFaces: string, hasFootnote: boolean): string {
  const rules = [
    `.sc-background{fill:${palette.canvas}}`,
    `.sc-node-fill{fill:${palette.surfaceRaised}}`,
    `.sc-node-header{fill:${palette.surface}}`,
    `.sc-view-header{fill:${palette.accentSubtle}}`,
    `.sc-node-stroke{fill:none;stroke:${palette.border};stroke-width:1}`,
    `.sc-divider{stroke:${palette.border};stroke-width:1}`,
    `.sc-title{font-family:${MONO_FONT_STACK};font-size:12px;fill:${palette.text}}`,
    `.sc-title-schema{fill:${palette.textMuted}}`,
    `.sc-title-name{font-weight:600}`,
    `.sc-count-pill{fill:${palette.surfaceSunken}}`,
    `.sc-count{font-family:${SANS_FONT_STACK};font-size:10px;font-weight:600;fill:${palette.textMuted};text-anchor:middle}`,
    `.sc-column{font-family:${SANS_FONT_STACK};font-size:12px;fill:${palette.text}}`,
    `.sc-type{font-family:${MONO_FONT_STACK};font-size:11px;fill:${palette.textMuted};text-anchor:end}`,
    `.sc-icon-kind{stroke:${palette.textMuted}}`,
    `.sc-icon-key{stroke:${palette.warning};color:${palette.warning}}`,
    `.sc-icon-link{stroke:${palette.accentText}}`,
    `.sc-relation{fill:none;stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-relation-disabled{stroke-dasharray:6 4}`,
    `.sc-marker{fill:none;stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-marker-fill{fill:${palette.canvas};stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-marker-active{fill:none;stroke:${palette.accent};stroke-width:2}`,
    `.sc-marker-fill-active{fill:${palette.canvas};stroke:${palette.accent};stroke-width:2}`,
  ];
  // Only documents with a footnote carry its rule, so other exports stay byte for byte the same.
  if (hasFootnote) {
    rules.push(
      `.sc-footnote{font-family:${SANS_FONT_STACK};font-size:11px;fill:${palette.textSecondary}}`,
    );
  }
  return `${fontFaces}${rules.join("")}`;
}

function marker(id: string, body: string, width: number, refX: number, orient: string): string {
  return (
    `<marker id="${id}" viewBox="0 0 ${width} 14" markerWidth="${width}" markerHeight="14" ` +
    `refX="${refX}" refY="7" orient="${orient}" markerUnits="userSpaceOnUse">${body}</marker>`
  );
}

function markers(): string {
  const crowsFoot = 'd="M13,7 L1,1 M13,7 L1,7 M13,7 L1,13"';
  const one = 'd="M6,1 L6,13 M1,7 L13,7"';
  const circle = 'cx="17" cy="7" r="3"';
  return [
    marker(MARKER_MANY, `<path class="sc-marker" ${crowsFoot}/>`, 14, 1, "auto-start-reverse"),
    marker(
      MARKER_MANY_OPTIONAL,
      `<path class="sc-marker" ${crowsFoot}/><circle class="sc-marker-fill" ${circle}/>`,
      22,
      1,
      "auto-start-reverse",
    ),
    marker(MARKER_ONE, `<path class="sc-marker" ${one}/>`, 14, 13, "auto"),
    marker(
      MARKER_MANY + ACTIVE_SUFFIX,
      `<path class="sc-marker-active" ${crowsFoot}/>`,
      14,
      1,
      "auto-start-reverse",
    ),
    marker(
      MARKER_MANY_OPTIONAL + ACTIVE_SUFFIX,
      `<path class="sc-marker-active" ${crowsFoot}/><circle class="sc-marker-fill-active" ${circle}/>`,
      22,
      1,
      "auto-start-reverse",
    ),
    marker(MARKER_ONE + ACTIVE_SUFFIX, `<path class="sc-marker-active" ${one}/>`, 14, 13, "auto"),
  ].join("");
}

function icon(id: string, className: string, x: number, y: number, size: number): string {
  return `<use href="#${id}" class="${className}" x="${coordinate(x)}" y="${coordinate(y)}" width="${size}" height="${size}"/>`;
}

function renderEntity(item: PlacedEntity, measure: TextMeasurer, detailLevel: DetailLevel): string {
  const { entity, rows, box } = item;
  const parts: string[] = [];
  const hasRows = rows.length > 0;
  const headerClass = entity.kind === "view" ? "sc-view-header" : "sc-node-header";
  parts.push(
    `<g class="sc-entity${entity.kind === "view" ? " sc-view" : ""}" data-entity="${escapeXml(entity.key)}" transform="translate(${coordinate(box.x)},${coordinate(box.y)})">`,
  );
  parts.push(
    `<rect class="sc-node-fill" width="${NODE_WIDTH}" height="${coordinate(box.height)}" rx="${CORNER_RADIUS}"/>`,
  );
  parts.push(
    `<rect class="${headerClass}" width="${NODE_WIDTH}" height="${HEADER_HEIGHT}" rx="${CORNER_RADIUS}"/>`,
  );
  if (hasRows) {
    parts.push(
      `<rect class="${headerClass}" y="${HEADER_HEIGHT / 2}" width="${NODE_WIDTH}" height="${HEADER_HEIGHT / 2}"/>`,
    );
    parts.push(
      `<line class="sc-divider" x1="0" y1="${HEADER_HEIGHT}" x2="${NODE_WIDTH}" y2="${HEADER_HEIGHT}"/>`,
    );
  }

  // Header: kind icon, "schema." muted and the name in semibold, the column count in a pill.
  const count = String(entity.columns.length);
  const pillWidth = Math.ceil(measure(count, COUNT_FONT)) + PILL_PADDING * 2;
  const pillX = NODE_WIDTH - HEADER_PADDING_RIGHT - pillWidth;
  const titleX = HEADER_PADDING_LEFT + ICON_SIZE + GAP;
  const titleMaxWidth = pillX - GAP - titleX;
  const schema = `${entity.name.schema}.`;
  const schemaWidth = measure(schema, TITLE_FONT);
  let shownSchema = schema;
  let shownName = fitText(entity.name.name, titleMaxWidth - schemaWidth, NAME_FONT, measure);
  if (schemaWidth > titleMaxWidth * 0.6) {
    shownSchema = fitText(schema, titleMaxWidth * 0.6, TITLE_FONT, measure);
    shownName = fitText(
      entity.name.name,
      titleMaxWidth - measure(shownSchema, TITLE_FONT),
      NAME_FONT,
      measure,
    );
  }
  parts.push(
    icon(
      entity.kind === "view" ? ICON_VIEW : ICON_TABLE,
      "sc-icon-kind",
      HEADER_PADDING_LEFT,
      (HEADER_HEIGHT - ICON_SIZE) / 2,
      ICON_SIZE,
    ),
  );
  parts.push(
    `<text class="sc-title" x="${titleX}" y="${coordinate(baseline(HEADER_HEIGHT / 2, TITLE_FONT.size))}">` +
      `<tspan class="sc-title-schema">${escapeXml(shownSchema)}</tspan>` +
      `<tspan class="sc-title-name">${escapeXml(shownName)}</tspan></text>`,
  );
  const pillY = (HEADER_HEIGHT - PILL_HEIGHT) / 2;
  parts.push(
    `<rect class="sc-count-pill" x="${pillX}" y="${pillY}" width="${pillWidth}" height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}"/>`,
  );
  parts.push(
    `<text class="sc-count" x="${coordinate(pillX + pillWidth / 2)}" y="${coordinate(baseline(HEADER_HEIGHT / 2, COUNT_FONT.size))}">${count}</text>`,
  );

  // Rows: role icons, the column name, and at full detail the type with "?" when nullable.
  rows.forEach((row, index) => {
    const centerY = rowCenterY(index);
    const iconY = centerY - ROLE_ICON_SIZE / 2;
    if (row.role === "primary" || row.role === "both") {
      parts.push(icon(ICON_KEY, "sc-icon-key", ROW_PADDING, iconY, ROLE_ICON_SIZE));
    }
    if (row.role === "foreign" || row.role === "both") {
      const x = row.role === "both" ? ROW_PADDING + ROLE_ICON_SIZE + 2 : ROW_PADDING;
      parts.push(icon(ICON_LINK, "sc-icon-link", x, iconY, ROLE_ICON_SIZE));
    }
    const nameX = ROW_PADDING + ROLE_WIDTH + GAP;
    const rightEdge = NODE_WIDTH - ROW_PADDING;
    let nameMaxWidth = rightEdge - nameX;
    if (detailLevel === "full") {
      const type = `${formatDataType(row.column.dataType)}${row.column.isNullable ? "?" : ""}`;
      const shownType = fitText(type, TYPE_MAX_WIDTH, TYPE_FONT, measure);
      nameMaxWidth -= measure(shownType, TYPE_FONT) + GAP;
      parts.push(
        `<text class="sc-type" x="${rightEdge}" y="${coordinate(baseline(centerY, TYPE_FONT.size))}">${escapeXml(shownType)}</text>`,
      );
    }
    parts.push(
      `<text class="sc-column" x="${nameX}" y="${coordinate(baseline(centerY, COLUMN_FONT.size))}">${escapeXml(fitText(row.column.name, nameMaxWidth, COLUMN_FONT, measure))}</text>`,
    );
  });

  parts.push(
    `<rect class="sc-node-stroke" x="0.5" y="0.5" width="${NODE_WIDTH - 1}" height="${coordinate(box.height - 1)}" rx="${CORNER_RADIUS}"/>`,
  );
  parts.push("</g>");
  return parts.join("");
}

function renderRelation(
  foreignKey: ForeignKey,
  placedByKey: ReadonlyMap<string, PlacedEntity>,
): string {
  const sourceKey = entityKey(foreignKey.referencingTable);
  const targetKey = entityKey(foreignKey.referencedTable);
  const source = placedByKey.get(sourceKey);
  const target = placedByKey.get(targetKey);
  if (source === undefined || target === undefined) {
    return "";
  }
  const firstPair = foreignKey.columnPairs[0];
  const sourceOffsetY = attachmentY(source.rows, firstPair?.referencingColumn ?? "");
  const targetOffsetY = attachmentY(target.rows, firstPair?.referencedColumn ?? "");
  let path: string;
  if (sourceKey === targetKey) {
    [path] = selfLoopPath(source.box, sourceOffsetY, targetOffsetY);
  } else {
    const [from, to] = relationAnchors(source.box, sourceOffsetY, target.box, targetOffsetY);
    [path] = getSmoothStepPath({
      sourceX: from.x,
      sourceY: from.y,
      sourcePosition: from.position,
      targetX: to.x,
      targetY: to.y,
      targetPosition: to.position,
      borderRadius: 8,
      offset: 16,
    });
  }
  const isOptional = isOptionalForeignKey(source.entity.columns, foreignKey);
  const classes = ["sc-relation", foreignKey.isEnabled ? "" : "sc-relation-disabled"]
    .filter((name) => name !== "")
    .join(" ");
  return (
    `<path class="${classes}" data-relation="${escapeXml(relationEdgeId(foreignKey))}" ` +
    `data-source="${escapeXml(sourceKey)}" data-target="${escapeXml(targetKey)}" ` +
    `marker-start="url(#${isOptional ? MARKER_MANY_OPTIONAL : MARKER_MANY})" marker-end="url(#${MARKER_ONE})" d="${path}"/>`
  );
}

/**
 * Draws the visible entities and their relationships as a standalone SVG document, with the
 * same geometry, anchors and markers as the canvas. The output is deterministic for a given
 * input and measurer.
 */
export function renderDiagramSvg(input: DiagramInput, options: RenderOptions): RenderedDiagram {
  const padding = options.padding ?? DEFAULT_PADDING;
  const measure = options.measureText ?? estimateTextWidth;
  const palette = DIAGRAM_PALETTES[options.theme];
  const { placed, relations, footnote, extent } = layoutDiagram(
    input,
    options.detailLevel,
    padding,
    options.footnote,
  );
  const placedByKey = new Map(placed.map((item) => [item.entity.key, item]));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${extent.width}" height="${extent.height}" ` +
      `viewBox="0 0 ${extent.width} ${extent.height}" data-generator="SchemaCraft" data-theme="${options.theme}" data-detail-level="${options.detailLevel}">`,
  );
  parts.push(`<title>${escapeXml(options.title ?? input.snapshot.databaseName)}</title>`);
  if (options.description !== undefined) {
    parts.push(`<desc>${escapeXml(options.description)}</desc>`);
  }
  parts.push(`<style>${styles(palette, options.fontFaces ?? "", footnote !== null)}</style>`);
  parts.push(`<defs>${ICON_SYMBOLS}${markers()}</defs>`);
  if (options.background ?? true) {
    parts.push(`<rect class="sc-background" width="${extent.width}" height="${extent.height}"/>`);
  }
  parts.push('<g class="sc-relations">');
  for (const foreignKey of relations) {
    parts.push(renderRelation(foreignKey, placedByKey));
  }
  parts.push("</g>");
  parts.push('<g class="sc-entities">');
  for (const item of placed) {
    parts.push(renderEntity(item, measure, options.detailLevel));
  }
  parts.push("</g>");
  if (footnote !== null) {
    parts.push(
      `<text class="sc-footnote" x="${coordinate(footnote.x)}" y="${coordinate(footnote.y)}">${escapeXml(footnote.text)}</text>`,
    );
  }
  parts.push("</svg>");
  return { ...extent, svg: parts.join("\n") };
}
