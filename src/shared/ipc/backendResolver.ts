import { isTauri } from "@tauri-apps/api/core";

/**
 * Builds the lazy resolver every feature backend uses: the Tauri commands inside the desktop
 * application, a simulated backend in a development browser preview, and a backend that reports
 * the runtime as unavailable anywhere else.
 *
 * Callers pass the preview loader as `import.meta.env.DEV ? () => import(...) : null`, so the
 * bundler drops the simulated module from production builds entirely.
 */
export function createBackendResolver<Backend>(
  tauriBackend: Backend,
  unavailableBackend: Backend,
  loadPreviewBackend: (() => Promise<Backend>) | null,
): () => Promise<Backend> {
  let backendPromise: Promise<Backend> | undefined;

  return () => {
    backendPromise ??= isTauri()
      ? Promise.resolve(tauriBackend)
      : loadPreviewBackend === null
        ? Promise.resolve(unavailableBackend)
        : loadPreviewBackend();
    return backendPromise;
  };
}
