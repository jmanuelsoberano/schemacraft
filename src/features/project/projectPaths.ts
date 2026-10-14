import { PROJECT_FILE_EXTENSION } from "@/shared/ipc/projectBackend";

const SEPARATORS = /[\\/]/;

/** Name shown for a project file: its base name without the `.scraft` extension. */
export function projectDisplayName(path: string): string {
  const fileName = path.split(SEPARATORS).pop() ?? path;
  const suffix = `.${PROJECT_FILE_EXTENSION}`;
  return fileName.toLowerCase().endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
}

/** Folder part of a path, for secondary text next to the file name. */
export function projectDirectory(path: string): string {
  const parts = path.split(SEPARATORS);
  parts.pop();
  return parts.join(path.includes("\\") ? "\\" : "/");
}
