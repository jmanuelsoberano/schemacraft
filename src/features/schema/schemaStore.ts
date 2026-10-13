import { create } from "zustand";

import type { ConnectionSettings, SchemaSnapshot } from "@/shared/contracts";

/** Where the current snapshot came from, kept in memory so it can be refreshed. */
export interface SchemaSource {
  /** Server as the user wrote it, e.g. `localhost\SQLEXPRESS`. */
  target: string;
  database: string;
  /** Settings that produced the snapshot, including any password, for "refresh from database". */
  settings: ConnectionSettings;
  loadedAt: Date;
}

interface SchemaState {
  snapshot: SchemaSnapshot | null;
  source: SchemaSource | null;
  setSnapshot: (snapshot: SchemaSnapshot, source: SchemaSource) => void;
  clear: () => void;
}

/** The schema currently loaded in the application. Not persisted; project files arrive later. */
export const useSchemaStore = create<SchemaState>()((set) => ({
  snapshot: null,
  source: null,
  setSnapshot: (snapshot, source) => {
    set({ snapshot, source });
  },
  clear: () => {
    set({ snapshot: null, source: null });
  },
}));
