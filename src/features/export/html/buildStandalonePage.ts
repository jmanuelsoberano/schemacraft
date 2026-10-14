import { escapeXml } from "../svg/text";
import { VIEWER_DATA_ELEMENT_ID, VIEWER_ROOT_ELEMENT_ID } from "./viewerData";
import type { ViewerData } from "./viewerData";

export interface StandalonePageParts {
  data: ViewerData;
  /** The bundled viewer, an immediately invoked script.*/
  viewerScript: string;
  /** The viewer's stylesheet. */
  viewerStyles: string;
  /** `@font-face` rules with embedded fonts; empty to rely on system fonts. */
  fontFaces: string;
}

/** JSON that is safe inside a `<script>` element: no `</script>`, no comment openers. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

/**
 * Assembles the self-contained page: the schema as JSON data, the viewer code and styles, and
 * optionally the fonts, with nothing loaded from the network.
 */
export function buildStandalonePage(parts: StandalonePageParts): string {
  const { data } = parts;
  const title = escapeXml(`${data.snapshot.databaseName} · SchemaCraft`);
  const script = parts.viewerScript.replaceAll("</script", "<\\/script");
  return [
    "<!doctype html>",
    `<html lang="${data.locale}" data-theme="${data.theme}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="${escapeXml(data.generator)}">`,
    `<title>${title}</title>`,
    `<style>${parts.fontFaces}${parts.viewerStyles}</style>`,
    "</head>",
    "<body>",
    `<div id="${VIEWER_ROOT_ELEMENT_ID}"></div>`,
    `<script id="${VIEWER_DATA_ELEMENT_ID}" type="application/json">${embedJson(data)}</script>`,
    `<script>${script}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
