import { create } from "zustand";

import type { ModuleRef } from "@/features/schema/modules";

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

/**
 * What a rule the reader points at in the Inspector involves: the columns it mentions and, for
 * a foreign key, its relationship. The cards and the edge read only their own part of it.
 */
export interface RuleHighlight {
  /** The rule item that set it; only the same owner clears it. */
  owner: string;
  /** Column names by entity key. */
  columns: ReadonlyMap<string, ReadonlySet<string>>;
  /** Id of the relationship to emphasise, or `null` for a `CHECK`. */
  edgeId: string | null;
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
  /** Exclusive selection of a procedure, function or trigger, never written to the project. */
  selectedModule: ModuleRef | null;
  /** Tells React Flow to drop its own node selection after selecting a module. */
  deselectRequest: number;
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
  /** The rule hovered or focused in the Inspector, if any. */
  ruleHighlight: RuleHighlight | null;
  setZoom: (zoom: number) => void;
  setSelectedKeys: (keys: readonly string[]) => void;
  selectModule: (module: ModuleRef, options?: InspectorOptions) => void;
  clearSelection: () => void;
  setHoveredEdge: (edgeId: string | null) => void;
  focusEntity: (key: string, options?: FocusOptions) => void;
  /** Drops a request only if it is still current, so stale canvas work cannot cancel a newer one. */
  cancelFocusRequest: (request: FocusRequest) => void;
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
  /** Replaces the rule highlight, whoever set the previous one. */
  setRuleHighlight: (highlight: RuleHighlight) => void;
  /**
   * Clears the rule highlight if `owner` set it, so an item that loses the pointer or unmounts
   * never clears the highlight another item has set since.
   */
  clearRuleHighlight: (owner: string) => void;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/**
 * Transient canvas state that is never saved: zoom, selection, hover, menus and requests, the
 * Inspector, which follows the selection, and the rule it highlights, which a change of
 * selection or a closed Inspector clears.
 */
export const useCanvasUiStore = create<CanvasUiState>()((set, get) => ({
  zoom: 1,
  selectedKeys: [],
  selectedModule: null,
  deselectRequest: 0,
  hoveredEdgeId: null,
  focusRequest: null,
  fitRequest: 0,
  highlightedKeys: new Set(),
  contextMenu: null,
  isLayoutRunning: false,
  lastLayout: { kind: "layered", direction: "down" },
  isInspectorOpen: false,
  inspectorFocusRequest: 0,
  ruleHighlight: null,
  setZoom: (zoom) => {
    set({ zoom });
  },
  setSelectedKeys: (keys) => {
    set((state) => {
      const selectedModule = keys.length > 0 ? null : state.selectedModule;
      const focusRequest =
        keys.length > 0 && (keys.length !== 1 || keys[0] !== state.focusRequest?.key)
          ? null
          : state.focusRequest;
      return sameKeys(state.selectedKeys, keys) &&
        selectedModule === state.selectedModule &&
        focusRequest === state.focusRequest
        ? {}
        : { selectedKeys: keys, selectedModule, focusRequest, ruleHighlight: null };
    });
  },
  selectModule: (selectedModule, { focus = false } = {}) => {
    set((state) => ({
      selectedModule,
      selectedKeys: [],
      deselectRequest: state.deselectRequest + 1,
      focusRequest: null,
      ruleHighlight: null,
      contextMenu: null,
      isInspectorOpen: true,
      inspectorFocusRequest: focus ? state.inspectorFocusRequest + 1 : state.inspectorFocusRequest,
    }));
  },
  clearSelection: () => {
    set((state) => ({
      selectedKeys: [],
      selectedModule: null,
      ruleHighlight: null,
      focusRequest: null,
      deselectRequest: state.deselectRequest + 1,
    }));
  },
  setHoveredEdge: (edgeId) => {
    set({ hoveredEdgeId: edgeId });
  },
  focusEntity: (key, { center = true } = {}) => {
    set((state) => ({
      focusRequest: { key, center, nonce: (state.focusRequest?.nonce ?? 0) + 1 },
      selectedModule: null,
      ruleHighlight: null,
    }));
  },
  cancelFocusRequest: (request) => {
    set((state) => (state.focusRequest === request ? { focusRequest: null } : {}));
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
    set({ isInspectorOpen: false, ruleHighlight: null });
  },
  toggleInspector: (options) => {
    const { isInspectorOpen, openInspector, closeInspector } = get();
    if (isInspectorOpen) {
      closeInspector();
    } else {
      openInspector(options);
    }
  },
  setRuleHighlight: (highlight) => {
    set({ ruleHighlight: highlight });
  },
  clearRuleHighlight: (owner) => {
    set((state) => (state.ruleHighlight?.owner === owner ? { ruleHighlight: null } : {}));
  },
}));
