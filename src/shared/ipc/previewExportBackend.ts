/**
 * Simulated export for development in a plain browser: SVG and HTML documents are offered as
 * downloads, PNG and PDF report that they need the desktop runtime. Loaded only in development
 * builds outside the desktop runtime.
 */
import type { ExportOutcome, ExportRequest } from "@/shared/contracts";

import type { ExportBackend } from "./exportBackend";
import { OperationError } from "./operationError";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).pop() ?? "diagram";
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export const previewExportBackend: ExportBackend = {
  pickDestination: (_title, suggestedFileName) =>
    Promise.resolve(`C:\\Exports\\${suggestedFileName}`),
  exportDiagram: async (request: ExportRequest, onEvent): Promise<ExportOutcome> => {
    onEvent({ event: "started", data: { jobId: "preview-export" } });
    onEvent({ event: "progress", data: "rendering" });
    await wait(400);
    if (request.format === "png" || request.format === "pdf") {
      throw new OperationError(
        { type: "export", value: "render" },
        "PNG and PDF are rendered by the desktop runtime; the browser preview writes SVG and HTML only.",
      );
    }
    onEvent({ event: "progress", data: "writing" });
    await wait(200);
    const blob = new Blob([request.document], {
      type: request.format === "svg" ? "image/svg+xml" : "text/html",
    });
    download(blob, fileName(request.destination));
    return { path: request.destination, bytes: blob.size, width: null, height: null };
  },
  cancelExport: () => Promise.resolve(),
  revealInFolder: () => Promise.resolve(),
};
