import {
  LOOP_REACH,
  MARKER_HEIGHT,
  MARKER_ORIENT,
  MARKER_REF_Y,
  RELATION_MARKER_SHAPES,
  relationPath,
} from "@/features/canvas/edgeGeometry";
import type {
  NodeBox,
  RelationMarkerKind,
  RelationMarkerShape,
} from "@/features/canvas/edgeGeometry";
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  describeEntities,
  nodeHeight,
  relationOffsets,
  rowCenterY,
  rowsFor,
} from "@/features/canvas/geometry";
import type { ColumnRow, EntityDescriptor, TriggerBadge } from "@/features/canvas/geometry";
import {
  gridPosition,
  nodeStatesByKey,
  relationEdgeId,
  relationEnds,
  tablesByKey,
} from "@/features/canvas/graph";
import { formatDataType } from "@/features/schema/dataType";
import { displayIdentifier, entityKey } from "@/features/schema/entities";
import { triggerCapture } from "@/features/schema/triggerDetails";
import type {
  CanvasState,
  DetailLevel,
  ForeignKey,
  SchemaSnapshot,
  Table,
} from "@/shared/contracts";

import {
  ICON_KEY,
  ICON_LINK,
  ICON_SYMBOLS,
  ICON_TABLE,
  ICON_VIEW,
  ICON_TRIGGER,
  ICON_TRIGGER_DISABLED,
  TRIGGER_ICON_SYMBOLS,
} from "./icons";
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

/**
 * Translated words drawn into the diagram. The renderer has no catalogue of its own: the
 * application passes its locale's text and the standalone viewer the one embedded with it.
 */
export interface DiagramLabels {
  /** The label on a view card, "VIEW" in English. */
  view: string;
  /** Full sentences for the badge's accessible name, with no module names or SQL. */
  triggers: (badge: TriggerBadge) => string;
}

export interface RenderOptions {
  detailLevel: DetailLevel;
  theme: ExportTheme;
  labels: DiagramLabels;
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
  /** Static exports explain trigger badges and any unverified trigger metadata below the drawing. */
  triggerNotes?: { legend: string; notRead: string; notChecked: string };
}

/** What sizes the document besides the diagram, as {@link renderDiagramSvg} will draw it. */
export type MeasureOptions = Pick<RenderOptions, "padding" | "footnote" | "triggerNotes">;

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

/**
 * Marker ids, named by what the end says; the `-active` ones are the accent-coloured variants
 * the HTML viewer switches to.
 */
export const MARKER_MANY = "sc-many";
export const MARKER_ONE = "sc-one";
export const MARKER_ZERO_OR_ONE = "sc-zero-or-one";
export const ACTIVE_SUFFIX = "-active";
const MARKER_IDS: Readonly<Record<RelationMarkerKind, string>> = {
  many: MARKER_MANY,
  one: MARKER_ONE,
  zeroOrOne: MARKER_ZERO_OR_ONE,
};

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
/** The VIEW label: as high as the count pill, square-cornered so the two never read as one. */
const LABEL_HEIGHT = 16;
const LABEL_PADDING = 5;
const LABEL_RADIUS = 4;
const TRIGGER_ICON_SIZE = 12;
const TRIGGER_PADDING = 5;
const TRIGGER_GAP = 3;
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
  footnotes: PlacedFootnote[];
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
  triggerNotes: RenderOptions["triggerNotes"],
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
  const notes = footnote ? [footnote] : [];
  if (triggerNotes !== undefined) {
    if (placed.some((item) => item.entity.triggers !== null)) notes.push(triggerNotes.legend);
    if (input.snapshot.programmability?.capture.objects.status !== "read") {
      notes.push(triggerNotes.notRead);
    } else if (
      placed.some((item) => triggerCapture(input.snapshot, item.entity.name).status !== "complete")
    ) {
      notes.push(triggerNotes.notChecked);
    }
  }
  const footnotes: PlacedFootnote[] = [];
  for (const [index, note] of notes.filter((text) => text !== "").entries()) {
    const top = maxY - minY + padding + FOOTNOTE_GAP + index * FOOTNOTE_LINE_HEIGHT;
    footnotes.push({
      text: note,
      x: padding,
      y: baseline(top + FOOTNOTE_LINE_HEIGHT / 2, FOOTNOTE_FONT.size),
    });
    // Sized with the estimate, which runs wider than the fonts for prose, so that measuring
    // without a text measurer and drawing with one agree and the line always fits.
    width = Math.max(width, Math.ceil(estimateTextWidth(note, FOOTNOTE_FONT) + padding * 2));
    height = Math.ceil(top + FOOTNOTE_LINE_HEIGHT + padding);
  }
  return {
    placed,
    relations,
    footnotes,
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
  return layoutDiagram(
    input,
    detailLevel,
    options.padding ?? DEFAULT_PADDING,
    options.footnote,
    options.triggerNotes,
  ).extent;
}

function styles(
  palette: DiagramPalette,
  fontFaces: string,
  hasFootnote: boolean,
  hasTriggers: boolean,
): string {
  const rules = [
    `.sc-background{fill:${palette.canvas}}`,
    `.sc-node-fill{fill:${palette.surfaceRaised}}`,
    `.sc-node-header{fill:${palette.surface}}`,
    // A view carries its own tint, icon colour and label, the same as the canvas card; the
    // muted schema prefix falls short of AA on the tint, so it takes the secondary text colour.
    `.sc-view-header{fill:${palette.viewSubtle}}`,
    `.sc-node-stroke{fill:none;stroke:${palette.border};stroke-width:1}`,
    `.sc-divider{stroke:${palette.border};stroke-width:1}`,
    `.sc-title{font-family:${MONO_FONT_STACK};font-size:12px;fill:${palette.text}}`,
    `.sc-title-schema{fill:${palette.textMuted}}`,
    `.sc-view-schema{fill:${palette.textSecondary}}`,
    `.sc-title-name{font-weight:600}`,
    `.sc-count-pill{fill:${palette.surfaceSunken}}`,
    `.sc-count{font-family:${SANS_FONT_STACK};font-size:10px;font-weight:600;fill:${palette.textMuted};text-anchor:middle}`,
    `.sc-kind-label{fill:${palette.view}}`,
    `.sc-kind-label-text{font-family:${SANS_FONT_STACK};font-size:10px;font-weight:600;fill:${palette.onView};text-anchor:middle}`,
    `.sc-column{font-family:${SANS_FONT_STACK};font-size:12px;fill:${palette.text}}`,
    `.sc-type{font-family:${MONO_FONT_STACK};font-size:11px;fill:${palette.textMuted};text-anchor:end}`,
    `.sc-icon-kind{stroke:${palette.textMuted}}`,
    `.sc-icon-view-kind{stroke:${palette.view}}`,
    `.sc-icon-key{stroke:${palette.warning};color:${palette.warning}}`,
    `.sc-icon-link{stroke:${palette.accentText}}`,
    `.sc-relation{fill:none;stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-relation-disabled{stroke-dasharray:6 4}`,
    `.sc-marker{fill:none;stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-marker-fill{fill:${palette.canvas};stroke:${palette.borderStrong};stroke-width:1.5}`,
    `.sc-marker-active{fill:none;stroke:${palette.accent};stroke-width:2}`,
    `.sc-marker-fill-active{fill:${palette.canvas};stroke:${palette.accent};stroke-width:2}`,
  ];
  if (hasTriggers) {
    rules.push(
      `.sc-trigger-badge{fill:none;stroke:${palette.borderStrong};stroke-width:1}`,
      `.sc-trigger-disabled{stroke-dasharray:3 2}`,
      `.sc-trigger-icon{stroke:${palette.textSecondary}}`,
      `.sc-trigger-count{font-family:${SANS_FONT_STACK};font-size:10px;font-weight:600;fill:${palette.textSecondary};text-anchor:middle}`,
    );
  }
  // Only documents with a footnote carry its rule, so other exports stay byte for byte the same.
  if (hasFootnote) {
    rules.push(
      `.sc-footnote{font-family:${SANS_FONT_STACK};font-size:11px;fill:${palette.textSecondary}}`,
    );
  }
  return `${fontFaces}${rules.join("")}`;
}

/** One `<marker>`; `suffix` picks the plain or the `-active` classes. */
function marker(id: string, shape: RelationMarkerShape, suffix: string): string {
  const circle = shape.circle
    ? `<circle class="sc-marker-fill${suffix}" cx="${shape.circle.cx}" cy="${shape.circle.cy}" r="${shape.circle.r}"/>`
    : "";
  return (
    `<marker id="${id}" viewBox="0 0 ${shape.width} ${MARKER_HEIGHT}" markerWidth="${shape.width}" markerHeight="${MARKER_HEIGHT}" ` +
    `refX="${shape.refX}" refY="${MARKER_REF_Y}" orient="${MARKER_ORIENT}" markerUnits="userSpaceOnUse">` +
    `<path class="sc-marker${suffix}" d="${shape.path}"/>${circle}</marker>`
  );
}

/** The crow's foot markers of the canvas, then their accent-coloured `-active` variants. */
function markers(): string {
  const kinds = Object.keys(RELATION_MARKER_SHAPES) as RelationMarkerKind[];
  return ["", ACTIVE_SUFFIX]
    .flatMap((suffix) =>
      kinds.map((kind) => marker(MARKER_IDS[kind] + suffix, RELATION_MARKER_SHAPES[kind], suffix)),
    )
    .join("");
}

function icon(id: string, className: string, x: number, y: number, size: number): string {
  return `<use href="#${id}" class="${className}" x="${coordinate(x)}" y="${coordinate(y)}" width="${size}" height="${size}"/>`;
}

function renderEntity(
  item: PlacedEntity,
  measure: TextMeasurer,
  detailLevel: DetailLevel,
  labels: DiagramLabels,
): string {
  const { entity, rows, box } = item;
  const parts: string[] = [];
  const hasRows = rows.length > 0;
  const isView = entity.kind === "view";
  const headerClass = isView ? "sc-view-header" : "sc-node-header";
  parts.push(
    `<g class="sc-entity${isView ? " sc-view" : ""}" data-entity="${escapeXml(entity.key)}" transform="translate(${coordinate(box.x)},${coordinate(box.y)})">`,
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

  // Header: kind icon, "schema." muted and the name in semibold, on a view the VIEW label, and
  // the column count in a pill.
  const count = String(entity.columns.length);
  const pillWidth = Math.ceil(measure(count, COUNT_FONT)) + PILL_PADDING * 2;
  const pillX = NODE_WIDTH - HEADER_PADDING_RIGHT - pillWidth;
  const trigger = entity.triggers;
  const triggerCount = trigger === null ? "" : String(trigger.count);
  const triggerWidth =
    trigger === null
      ? 0
      : Math.ceil(measure(triggerCount, COUNT_FONT)) +
        TRIGGER_PADDING * 2 +
        2 +
        TRIGGER_ICON_SIZE +
        TRIGGER_GAP;
  const triggerX = pillX - GAP - triggerWidth;
  const beforeCount = trigger === null ? pillX : triggerX;
  const labelWidth = isView ? Math.ceil(measure(labels.view, COUNT_FONT)) + LABEL_PADDING * 2 : 0;
  const labelX = beforeCount - GAP - labelWidth;
  const titleX = HEADER_PADDING_LEFT + ICON_SIZE + GAP;
  const titleMaxWidth = (isView ? labelX : beforeCount) - GAP - titleX;
  const schema = `${displayIdentifier(entity.name.schema)}.`;
  const schemaWidth = measure(schema, TITLE_FONT);
  let shownSchema = schema;
  const name = displayIdentifier(entity.name.name);
  let shownName = fitText(name, titleMaxWidth - schemaWidth, NAME_FONT, measure);
  if (schemaWidth > titleMaxWidth * 0.6) {
    shownSchema = fitText(schema, titleMaxWidth * 0.6, TITLE_FONT, measure);
    shownName = fitText(name, titleMaxWidth - measure(shownSchema, TITLE_FONT), NAME_FONT, measure);
  }
  parts.push(
    icon(
      isView ? ICON_VIEW : ICON_TABLE,
      isView ? "sc-icon-view-kind" : "sc-icon-kind",
      HEADER_PADDING_LEFT,
      (HEADER_HEIGHT - ICON_SIZE) / 2,
      ICON_SIZE,
    ),
  );
  parts.push(
    `<text class="sc-title" x="${titleX}" y="${coordinate(baseline(HEADER_HEIGHT / 2, TITLE_FONT.size))}">` +
      `<tspan class="${isView ? "sc-view-schema" : "sc-title-schema"}">${escapeXml(shownSchema)}</tspan>` +
      `<tspan class="sc-title-name">${escapeXml(shownName)}</tspan></text>`,
  );
  if (isView) {
    const labelY = (HEADER_HEIGHT - LABEL_HEIGHT) / 2;
    parts.push(
      `<rect class="sc-kind-label" x="${labelX}" y="${labelY}" width="${labelWidth}" height="${LABEL_HEIGHT}" rx="${LABEL_RADIUS}"/>`,
    );
    parts.push(
      `<text class="sc-kind-label-text" x="${coordinate(labelX + labelWidth / 2)}" y="${coordinate(baseline(HEADER_HEIGHT / 2, COUNT_FONT.size))}">${escapeXml(labels.view)}</text>`,
    );
  }
  if (trigger !== null) {
    const label = escapeXml(labels.triggers(trigger));
    parts.push(`<g class="sc-triggers" role="img" aria-label="${label}"><title>${label}</title>`);
    parts.push(
      `<rect class="sc-trigger-badge${trigger.allDisabled ? " sc-trigger-disabled" : ""}" x="${coordinate(triggerX + 0.5)}" y="${(HEADER_HEIGHT - PILL_HEIGHT) / 2 + 0.5}" width="${triggerWidth - 1}" height="${PILL_HEIGHT - 1}" rx="${PILL_HEIGHT / 2}"/>`,
    );
    parts.push(
      icon(
        trigger.allDisabled ? ICON_TRIGGER_DISABLED : ICON_TRIGGER,
        "sc-trigger-icon",
        triggerX + TRIGGER_PADDING + 1,
        (HEADER_HEIGHT - TRIGGER_ICON_SIZE) / 2,
        TRIGGER_ICON_SIZE,
      ),
    );
    parts.push(
      `<text class="sc-trigger-count" x="${coordinate(triggerX + triggerWidth - TRIGGER_PADDING - 1 - Math.ceil(measure(triggerCount, COUNT_FONT)) / 2)}" y="${coordinate(baseline(HEADER_HEIGHT / 2, COUNT_FONT.size))}">${triggerCount}</text></g>`,
    );
  }
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
    // The full name rides along with the shown one, which may be cut short, so the viewer can
    // find a rule's columns on the diagram.
    parts.push(
      `<text class="sc-column" data-column="${escapeXml(row.column.name)}" x="${nameX}" y="${coordinate(baseline(centerY, COLUMN_FONT.size))}">${escapeXml(fitText(row.column.name, nameMaxWidth, COLUMN_FONT, measure))}</text>`,
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
  tables: ReadonlyMap<string, Table>,
): string {
  const sourceKey = entityKey(foreignKey.referencingTable);
  const targetKey = entityKey(foreignKey.referencedTable);
  const source = placedByKey.get(sourceKey);
  const target = placedByKey.get(targetKey);
  if (source === undefined || target === undefined) {
    return "";
  }
  const [sourceOffsetY, targetOffsetY] = relationOffsets(foreignKey, source.rows, target.rows);
  const [path] = relationPath(
    source.box,
    sourceOffsetY,
    target.box,
    targetOffsetY,
    sourceKey === targetKey,
  );
  const ends = relationEnds(tables.get(sourceKey), foreignKey);
  const classes = ["sc-relation", foreignKey.isEnabled ? "" : "sc-relation-disabled"]
    .filter((name) => name !== "")
    .join(" ");
  return (
    `<path class="${classes}" data-relation="${escapeXml(relationEdgeId(foreignKey))}" ` +
    `data-source="${escapeXml(sourceKey)}" data-target="${escapeXml(targetKey)}" ` +
    `marker-start="url(#${MARKER_IDS[ends.start]})" marker-end="url(#${MARKER_IDS[ends.end]})" d="${path}"/>`
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
  const { placed, relations, footnotes, extent } = layoutDiagram(
    input,
    options.detailLevel,
    padding,
    options.footnote,
    options.triggerNotes,
  );
  const hasTriggers = placed.some((item) => item.entity.triggers !== null);
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
  parts.push(
    `<style>${styles(palette, options.fontFaces ?? "", footnotes.length > 0, hasTriggers)}</style>`,
  );
  parts.push(`<defs>${ICON_SYMBOLS}${hasTriggers ? TRIGGER_ICON_SYMBOLS : ""}${markers()}</defs>`);
  if (options.background ?? true) {
    parts.push(`<rect class="sc-background" width="${extent.width}" height="${extent.height}"/>`);
  }
  parts.push('<g class="sc-relations">');
  const tables = tablesByKey(input.snapshot);
  for (const foreignKey of relations) {
    parts.push(renderRelation(foreignKey, placedByKey, tables));
  }
  parts.push("</g>");
  parts.push('<g class="sc-entities">');
  for (const item of placed) {
    parts.push(renderEntity(item, measure, options.detailLevel, options.labels));
  }
  parts.push("</g>");
  for (const footnote of footnotes) {
    parts.push(
      `<text class="sc-footnote" x="${coordinate(footnote.x)}" y="${coordinate(footnote.y)}">${escapeXml(footnote.text)}</text>`,
    );
  }
  parts.push("</svg>");
  return { ...extent, svg: parts.join("\n") };
}
