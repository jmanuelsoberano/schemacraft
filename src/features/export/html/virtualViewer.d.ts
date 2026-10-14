/** The standalone viewer, bundled by the `schemacraft-viewer-bundle` plugin in vite.config.ts. */
declare module "virtual:schemacraft-viewer" {
  /** Immediately invoked script that renders the viewer into the page. */
  export const viewerScript: string;
  /** Stylesheet of the viewer. */
  export const viewerStyles: string;
}
