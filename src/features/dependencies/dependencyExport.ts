import type { Point } from "@/shared/contracts";
import { DIAGRAM_PALETTES, viewerPaletteStyles } from "@/features/export/svg/palette";
import type { ExportTheme } from "@/features/export/svg/palette";
import { escapeXml } from "@/features/export/svg/text";
import { embedJson } from "@/features/export/html/buildStandalonePage";

import type { DependencyGraph, DependencyGraphEdge } from "./dependencyGraph";
import { DEPENDENCY_VIEWER_SCRIPT } from "./dependencyViewer";

export const DEPENDENCY_NODE_WIDTH = 300;
export const DEPENDENCY_NODE_HEIGHT = 108;
const EDGE_STROKE_WIDTH = 1.5;
const ARROW_MARKER = { width: 10, height: 10, refX: 9, refY: 3 };
// Covers the marker viewport at any tangent angle, including its stroke-scaled units.
const EDGE_CLEARANCE = Math.ceil(
  Math.hypot(
    Math.max(ARROW_MARKER.refX, ARROW_MARKER.width - ARROW_MARKER.refX),
    Math.max(ARROW_MARKER.refY, ARROW_MARKER.height - ARROW_MARKER.refY),
  ) *
    EDGE_STROKE_WIDTH +
    EDGE_STROKE_WIDTH / 2,
);

function positionFor(id: string, positions: ReadonlyMap<string, Point>): Point {
  return positions.get(id) ?? { x: 40, y: 40 };
}

/** A cubic stays inside its control hull; drawing and sizing share this single geometry. */
function edgeGeometry(edge: DependencyGraphEdge, positions: ReadonlyMap<string, Point>) {
  const source = positionFor(edge.source, positions);
  const target = positionFor(edge.target, positions);
  const start = { x: source.x + DEPENDENCY_NODE_WIDTH, y: source.y + DEPENDENCY_NODE_HEIGHT / 2 };
  const end = { x: target.x, y: target.y + DEPENDENCY_NODE_HEIGHT / 2 };
  const bend = Math.max(45, Math.abs(end.x - start.x) / 2);
  const first =
    edge.source === edge.target
      ? { x: start.x + 80, y: start.y - 110 }
      : { x: start.x + bend, y: start.y };
  const second =
    edge.source === edge.target ? { x: end.x - 80, y: end.y - 110 } : { x: end.x - bend, y: end.y };
  const controls = [start, first, second, end];
  return {
    path: `M${start.x},${start.y} C${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`,
    minX: Math.min(...controls.map((point) => point.x)) - EDGE_CLEARANCE,
    minY: Math.min(...controls.map((point) => point.y)) - EDGE_CLEARANCE,
    maxX: Math.max(...controls.map((point) => point.x)) + EDGE_CLEARANCE,
    maxY: Math.max(...controls.map((point) => point.y)) + EDGE_CLEARANCE,
  };
}

export interface DependencyExportLabels {
  title: string;
  limitation: string;
  direction: string;
  capture: string;
  retained: string;
  search: string;
  fit: string;
  zoomIn: string;
  zoomOut: string;
  kinds: Record<string, string>;
  statuses: Record<string, string>;
  limitations: Record<string, string>;
  reasons: Record<string, string>;
  edgeKinds: Record<string, string>;
  routineTrackingTitle: string;
  routineTracking: Record<string, string>;
  routineTrackingHints: Record<string, string>;
  omitted?: string;
}

function footerCaptions(graph: DependencyGraph, labels: DependencyExportLabels): string[] {
  return [
    labels.limitation,
    labels.direction,
    `${labels.capture}: ${labels.statuses[graph.capture] ?? graph.capture}`,
    ...(graph.captureReason == null
      ? []
      : [labels.reasons[graph.captureReason] ?? labels.reasons.unknown ?? graph.captureReason]),
    ...graph.limitations.map((code) => labels.limitations[code] ?? code),
    ...(labels.omitted === undefined ? [] : [labels.omitted]),
    ...new Set(graph.edges.map((edge) => labels.edgeKinds[edge.kind] ?? edge.kind)),
    ...new Set(
      graph.nodes.flatMap((node) =>
        node.routineBodyTracking === undefined
          ? []
          : [
              labels.routineTrackingHints[node.routineBodyTracking] ??
                labels.routineTrackingHints.unknown ??
                "",
            ],
      ),
    ),
  ];
}

function wrappedFooter(
  graph: DependencyGraph,
  labels: DependencyExportLabels,
  width: number,
): string[] {
  const captions = footerCaptions(graph, labels);
  const columns = Math.max(20, Math.floor((width - 60) / 7));
  return captions.flatMap((caption) => {
    const characters = Array.from(caption);
    const rows: string[] = [];
    for (let offset = 0; offset < characters.length; offset += columns)
      rows.push(characters.slice(offset, offset + columns).join(""));
    return rows;
  });
}

/** Export bounds include nodes, full edge control hulls/markers and captions, never the viewport. */
export function dependencyGraphExtent(
  graph: DependencyGraph,
  positions: ReadonlyMap<string, Point>,
  labels: DependencyExportLabels,
) {
  let minX = 0;
  let minY = 0;
  let maxX = 600;
  let maxY = 180;
  for (const node of graph.nodes) {
    const point = positionFor(node.id, positions);
    minX = Math.min(minX, point.x - 30);
    minY = Math.min(minY, point.y - 80);
    maxX = Math.max(maxX, point.x + DEPENDENCY_NODE_WIDTH + 30);
    maxY = Math.max(maxY, point.y + DEPENDENCY_NODE_HEIGHT + 30);
  }
  for (const edge of graph.edges) {
    const bounds = edgeGeometry(edge, positions);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY - 50);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY + 30);
  }
  const width = maxX - minX;
  const footer = wrappedFooter(graph, labels, width);
  return { minX, minY, maxY, width, height: maxY - minY + footer.length * 22 + 25, footer };
}

/** Draws only the supplied closed projection; the viewport never clips the exported graph. */
export function renderDependencySvg(
  graph: DependencyGraph,
  positions: ReadonlyMap<string, Point>,
  labels: DependencyExportLabels,
  theme: ExportTheme,
): string {
  const palette = DIAGRAM_PALETTES[theme];
  const position = (id: string) => positionFor(id, positions);
  const { minX, minY, maxY, width, height, footer } = dependencyGraphExtent(
    graph,
    positions,
    labels,
  );
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" role="img">`,
    `<title>${escapeXml(labels.title)}</title>`,
    `<desc>${escapeXml(footerCaptions(graph, labels).join(" "))}</desc>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.canvas}"/>`,
    `<defs><marker id="dependency-arrow" markerWidth="${ARROW_MARKER.width}" markerHeight="${ARROW_MARKER.height}" refX="${ARROW_MARKER.refX}" refY="${ARROW_MARKER.refY}" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${palette.textSecondary}"/></marker></defs>`,
    `<text x="${minX + 30}" y="${minY + 30}" font-family="Segoe UI, sans-serif" font-size="18" font-weight="600" fill="${palette.text}">${escapeXml(labels.title)}</text>`,
  ];
  for (const edge of graph.edges) {
    const { path } = edgeGeometry(edge, positions);
    parts.push(
      `<path d="${path}" fill="none" stroke="${palette.textSecondary}" stroke-width="${EDGE_STROKE_WIDTH}"${edge.retained ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#dependency-arrow)"><title>${escapeXml(labels.edgeKinds[edge.kind] ?? edge.kind)}</title></path>`,
    );
  }
  for (const node of graph.nodes) {
    const point = position(node.id);
    const status = node.retained ? labels.retained : (labels.statuses[node.status] ?? node.status);
    const tracking =
      node.routineBodyTracking === undefined
        ? null
        : (labels.routineTracking[node.routineBodyTracking] ??
          labels.routineTracking.unknown ??
          "");
    // Full identity remains in title and reviewed JSON; long visual labels wrap predictably.
    const chunks = Array.from(node.label).reduce<string[]>((rows, character, index) => {
      const row = Math.floor(index / 36);
      rows[row] = (rows[row] ?? "") + character;
      return rows;
    }, []);
    parts.push(
      `<g data-node="${escapeXml(node.id)}" transform="translate(${point.x},${point.y})">`,
      `<title>${escapeXml(node.label)} · ${escapeXml(status)}${tracking === null ? "" : ` · ${escapeXml(labels.routineTrackingTitle)}: ${escapeXml(tracking)}`}${node.readAt === null ? "" : ` · ${escapeXml(node.readAt)}`}</title>`,
      `<rect width="${DEPENDENCY_NODE_WIDTH}" height="${DEPENDENCY_NODE_HEIGHT}" rx="7" fill="${palette.surface}" stroke="${node.kind === "reference" ? palette.warning : palette.borderStrong}"${node.retained ? ' stroke-dasharray="6 4"' : ""}/>`,
      `<text x="12" y="18" font-family="Segoe UI, sans-serif" font-size="11" fill="${palette.textSecondary}">${escapeXml(labels.kinds[node.kind] ?? node.kind)} · ${escapeXml(status)}</text>`,
      ...chunks
        .slice(0, 2)
        .map(
          (line, index) =>
            `<text x="12" y="${39 + index * 18}" font-family="Segoe UI, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(line)}${index === 1 && chunks.length > 2 ? "…" : ""}</text>`,
        ),
      ...(tracking === null
        ? []
        : [
            `<text x="12" y="80" font-family="Segoe UI, sans-serif" font-size="10" fill="${palette.textSecondary}">${escapeXml(tracking)}</text>`,
          ]),
      ...(node.retained && node.readAt !== null
        ? [
            `<text x="12" y="99" font-family="Segoe UI, sans-serif" font-size="10" fill="${palette.textSecondary}">${escapeXml(node.readAt)}</text>`,
          ]
        : []),
      "</g>",
    );
  }
  for (const [index, text] of footer.entries()) {
    // Footer text is wrapped independently of the captured graph size.
    parts.push(
      `<text x="${minX + 30}" y="${maxY + 20 + index * 22}" font-family="Segoe UI, sans-serif" font-size="11" fill="${palette.textSecondary}">${escapeXml(text)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/** Offline viewer. Scripts use DOM text and SVG nodes; captured text is never evaluated. */
export function buildDependencyHtml(
  graph: DependencyGraph,
  svg: string,
  labels: DependencyExportLabels,
  locale: "en" | "es",
  theme: ExportTheme = "light",
): string {
  const words = {
    kinds: labels.kinds,
    statuses: labels.statuses,
    retained: labels.retained,
    routineTrackingTitle: labels.routineTrackingTitle,
    routineTracking: labels.routineTracking,
    routineTrackingHints: labels.routineTrackingHints,
  };
  const script = DEPENDENCY_VIEWER_SCRIPT.replaceAll("</script", "<\\/script");
  return `<!doctype html><html lang="${locale}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeXml(labels.title)}</title>
<style>${viewerPaletteStyles()}
body{margin:0;font:14px 'Segoe UI',sans-serif;background:var(--sc-canvas);color:var(--sc-text)}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px;border-bottom:1px solid var(--sc-border-strong)}
h1{font-size:18px;margin:0}button,input{font:inherit;padding:6px;color:var(--sc-text);background:var(--sc-surface);border:1px solid var(--sc-border-strong);border-radius:4px}
button{cursor:pointer}button:focus-visible,input:focus-visible,g[data-node]:focus-visible{outline:2px solid var(--sc-accent);outline-offset:3px}
main{height:calc(100vh - 160px);min-height:240px;overflow:hidden}svg{width:100%;height:100%;touch-action:none}g[data-node]{cursor:pointer}g[data-selected] rect{stroke:var(--sc-accent);stroke-width:3}
aside{padding:12px;white-space:pre-wrap}p{margin:4px 12px}</style></head><body>
<header><h1>${escapeXml(labels.title)}</h1><label>${escapeXml(labels.search)} <input id="search" type="search"></label><button id="fit">${escapeXml(labels.fit)}</button><button id="in">${escapeXml(labels.zoomIn)}</button><button id="out">${escapeXml(labels.zoomOut)}</button></header>
<p>${escapeXml(labels.limitation)} ${escapeXml(labels.direction)}</p><main>${svg}</main><aside id="details" aria-live="polite"></aside>
<script type="application/json" id="graph">${embedJson(graph)}</script><script type="application/json" id="words">${embedJson(words)}</script><script>${script}</script></body></html>`;
}
