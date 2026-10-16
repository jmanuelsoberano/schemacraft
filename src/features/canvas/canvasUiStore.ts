import { create } from "zustand";

import type { LayoutRequest } from "./layouts";

/** A request to bring an entity into view, from the sidebar or the command palette. */
export interface FocusRequest {
  key: string;
  /** Whether the canvas also pans to the entity; `false` selects it where it is. */
  center: boolean;
  /** Changes on every request so the same entity can be focused twice in a row. */
  nonce: number;
}

/** A context menu opened on an entity, at a screen position. */
export interface EntityContextMenu {
  key: string;
  x: number;
  y: number;
}

interface FocusOptions {
  center?: boolean;
}

interface InspectorOptions {
  /** Move keyboard focus into the panel once it is open; every way in but a double-click asks it. */
  focus?: boolean;
}

interface CanvasUiState {
  /** Current zoom factor, for the status bar and semantic zoom. */
  zoom: number;
  selectedKeys: readonly string[];
  hoveredEdgeId: string | null;
  focusRequest: FocusRequest | null;
  /** Incremented whenever the whole diagram should be fitted into view. */
  fitRequest: number;
  /** Entities added by the last refresh, highlighted until the user interacts. */
  highlightedKeys: ReadonlySet<string>;
  contextMenu: EntityContextMenu | null;
  isLayoutRunning: boolean;
  /** Layout repeated by the "auto layout" action. */
  lastLayout: LayoutRequest;
  /** The Inspector shows the selected entity; it starts closed on every launch and is never saved. */
  isInspectorOpen: boolean;
  /** Incremented whenever the open Inspector should take keyboard focus. */
  inspectorFocusRequest: number;
  setZoom: (zoom: number) => void;
  setSelectedKeys: (keys: readonly string[]) => void;
  setHoveredEdge: (edgeId: string | null) => void;
  focusEntity: (key: string, options?: FocusOptions) => void;
  requestFit: () => void;
  highlightEntities: (keys: readonly string[]) => void;
  clearHighlights: () => void;
  openContextMenu: (menu: EntityContextMenu) => void;
  closeContextMenu: () => void;
  setLayoutRunning: (isRunning: boolean) => void;
  setLastLayout: (layout: LayoutRequest) => void;
  openInspector: (options?: InspectorOptions) => void;
  closeInspector: () => void;
  toggleInspector: (options?: InspectorOptions) => void;
}

/**
 * Transient canvas state that is never saved: zoom, selection, hover, menus and requests, and
 * the Inspector, which follows the selection.
 */
export const useCanvasUiStore = create<CanvasUiState>()((set, get) => ({
  zoom: 1,
  selectedKeys: [],
  hoveredEdgeId: null,
  focusRequest: null,
  fitRequest: 0,
  highlightedKeys: new Set(),
  contextMenu: null,
  isLayoutRunning: false,
  lastLayout: { kind: "layered", direction: "down" },
  isInspectorOpen: false,
  inspectorFocusRequest: 0,
  setZoom: (zoom) => {
    set({ zoom });
  },
  setSelectedKeys: (keys) => {
    set({ selectedKeys: keys });
  },
  setHoveredEdge: (edgeId) => {
    set({ hoveredEdgeId: edgeId });
  },
  focusEntity: (key, { center = true } = {}) => {
    set((state) => ({
      focusRequest: { key, center, nonce: (state.focusRequest?.nonce ?? 0) + 1 },
    }));
  },
  requestFit: () => {
    set((state) => ({ fitRequest: state.fitRequest + 1 }));
  },
  highlightEntities: (keys) => {
    set({ highlightedKeys: new Set(keys) });
  },
  clearHighlights: () => {
    set((state) => (state.highlightedKeys.size === 0 ? {} : { highlightedKeys: new Set() }));
  },
  openContextMenu: (menu) => {
    set({ contextMenu: menu });
  },
  closeContextMenu: () => {
    set({ contextMenu: null });
  },
  setLayoutRunning: (isRunning) => {
    set({ isLayoutRunning: isRunning });
  },
  setLastLayout: (layout) => {
    set({ lastLayout: layout });
  },
  openInspector: ({ focus = false } = {}) => {
    set((state) => ({
      isInspectorOpen: true,
      inspectorFocusRequest: focus ? state.inspectorFocusRequest + 1 : state.inspectorFocusRequest,
    }));
  },
  closeInspector: () => {
    set({ isInspectorOpen: false });
  },
  toggleInspector: (options) => {
    const { isInspectorOpen, openInspector, closeInspector } = get();
    if (isInspectorOpen) {
      closeInspector();
    } else {
      openInspector(options);
    }
  },
}));
