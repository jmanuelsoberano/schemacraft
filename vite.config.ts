/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { build, defineConfig } from "vite";
import type { Plugin } from "vite";

const tauriDevelopmentHost = process.env.TAURI_DEV_HOST;
const isTauriDebugBuild = Boolean(process.env.TAURI_ENV_DEBUG);
const sourceAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

const VIEWER_MODULE_ID = "virtual:schemacraft-viewer";
const RESOLVED_VIEWER_ID = `\0${VIEWER_MODULE_ID}`;
const VIEWER_SOURCES =
  /[\\/]src[\\/](viewer|features[\\/](export|canvas|schema)|shared[\\/]i18n)[\\/]/u;

interface ViewerBundle {
  script: string;
  styles: string;
}

/** Bundles the standalone viewer (src/viewer) into one script and one stylesheet, in memory. */
async function bundleViewer(): Promise<ViewerBundle> {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: sourceAlias },
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      target: "es2022",
      lib: {
        entry: fileURLToPath(new URL("./src/viewer/main.ts", import.meta.url)),
        formats: ["iife"],
        name: "SchemaCraftViewer",
        fileName: () => "viewer.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const bundle: ViewerBundle = { script: "", styles: "" };
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!("output" in output)) {
      continue;
    }
    for (const item of output.output) {
      if (item.type === "chunk") {
        bundle.script += item.code;
      } else if (item.fileName.endsWith(".css") && typeof item.source === "string") {
        bundle.styles += item.source;
      }
    }
  }
  return bundle;
}

/**
 * Serves `virtual:schemacraft-viewer`, the viewer embedded in exported HTML files. The bundle is
 * built on first use and rebuilt after a change to the viewer or the renderer it shares.
 */
function viewerBundle(): Plugin {
  let pending: Promise<ViewerBundle> | null = null;
  return {
    name: "schemacraft-viewer-bundle",
    resolveId(id) {
      return id === VIEWER_MODULE_ID ? RESOLVED_VIEWER_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_VIEWER_ID) {
        return undefined;
      }
      pending ??= bundleViewer();
      const { script, styles } = await pending;
      return `export const viewerScript = ${JSON.stringify(script)};\nexport const viewerStyles = ${JSON.stringify(styles)};\n`;
    },
    handleHotUpdate({ file, server }) {
      if (VIEWER_SOURCES.test(file)) {
        pending = null;
        const module = server.moduleGraph.getModuleById(RESOLVED_VIEWER_ID);
        if (module !== undefined) {
          server.moduleGraph.invalidateModule(module);
        }
      }
    },
  };
}

// Vite options tailored for Tauri: https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), viewerBundle()],
  resolve: {
    alias: sourceAlias,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: tauriDevelopmentHost ?? false,
    hmr: tauriDevelopmentHost
      ? { protocol: "ws", host: tauriDevelopmentHost, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // WebView2 ships an evergreen Chromium, so no transpiling for legacy engines is needed.
    target: "chrome120",
    minify: !isTauriDebugBuild,
    sourcemap: isTauriDebugBuild,
    // Assets load from disk inside the desktop shell, so code splitting buys nothing here.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A stylesheet imported as text (`?raw`) reaches the tests whole; vitest blanks CSS otherwise.
    css: { include: [/\?raw$/u] },
  },
});
