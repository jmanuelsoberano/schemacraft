/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tauriDevelopmentHost = process.env.TAURI_DEV_HOST;
const isTauriDebugBuild = Boolean(process.env.TAURI_ENV_DEBUG);

// Vite options tailored for Tauri: https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
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
  },
});
