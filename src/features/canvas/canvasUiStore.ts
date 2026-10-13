import { create } from "zustand";

/** A request to bring an entity into view, from the sidebar or the command palette. */
export interface FocusRequest {
  key: string;
  /** Changes on every request so the same entity can be focused twice in a row. */
  nonce: number;
}

interface CanvasUiState {
  /** Current zoom factor, for the status bar and semantic zoom. */
  zoom: number;
  selectedKeys: readonly string[];
  hoveredEdgeId: string | null;
  focusRequest: FocusRequest | null;
  /** Entities added by the last refresh, highlighted until the user interacts. */
  highlightedKeys: ReadonlySet<string>;
  setZoom: (zoom: number) => void;
  setSelectedKeys: (keys: readonly string[]) => void;
  setHoveredEdge: (edgeId: string | null) => void;
  focusEntity: (key: string) => void;
  highlightEntities: (keys: readonly string[]) => void;
  clearHighlights: () => void;
}

/** Transient canvas state that is never saved: zoom, selection, hover and focus requests. */
export const useCanvasUiStore = create<CanvasUiState>()((set) => ({
  zoom: 1,
  selectedKeys: [],
  hoveredEdgeId: null,
  focusRequest: null,
  highlightedKeys: new Set(),
  setZoom: (zoom) => {
    set({ zoom });
  },
  setSelectedKeys: (keys) => {
    set({ selectedKeys: keys });
  },
  setHoveredEdge: (edgeId) => {
    set({ hoveredEdgeId: edgeId });
  },
  focusEntity: (key) => {
    set((state) => ({ focusRequest: { key, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }));
  },
  highlightEntities: (keys) => {
    set({ highlightedKeys: new Set(keys) });
  },
  clearHighlights: () => {
    set((state) => (state.highlightedKeys.size === 0 ? {} : { highlightedKeys: new Set() }));
  },
}));
