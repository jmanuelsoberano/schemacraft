import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type {
  NodeMouseHandler,
  OnMoveEnd,
  OnNodeDrag,
  OnSelectionChangeFunc,
  ReactFlowInstance,
  Viewport,
} from "@xyflow/react";
import { DatabaseZap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { ProjectNotice } from "@/features/project/ProjectNotice";
import { useProjectStore } from "@/features/project/projectStore";
import { emptySchemaReason } from "@/features/schema/coverage";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Spinner } from "@/shared/ui/Spinner";
import { classNames } from "@/shared/ui/classNames";

import styles from "./DiagramCanvas.module.css";
import { EntityNode } from "./EntityNode";
import { RelationEdge } from "./RelationEdge";
import { RelationMarkers } from "./RelationMarkers";
import { layoutFreshProject, setCollapsed } from "./canvasActions";
import { returnFocusFromInspector } from "./canvasFocus";
import { withPositions } from "./canvasState";
import { useCanvasUiStore } from "./canvasUiStore";
import { COMPACT_ZOOM_THRESHOLD, describeEntities, effectiveDetailLevel } from "./geometry";
import type { EntityDescriptor } from "./geometry";
import {
  ENTITY_NODE_TYPE,
  RELATION_EDGE_TYPE,
  buildEntityNodes,
  buildRelationEdges,
} from "./graph";
import type { EntityNode as EntityNodeType, RelationEdge as RelationEdgeType } from "./graph";

// Stable references keep React Flow from re-initialising on every render.
const NODE_TYPES = { [ENTITY_NODE_TYPE]: EntityNode };
const EDGE_TYPES = { [RELATION_EDGE_TYPE]: RelationEdge };
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
const NO_ENTITIES: ReadonlyMap<string, EntityDescriptor> = new Map();

type FlowInstance = ReactFlowInstance<EntityNodeType, RelationEdgeType>;

/** Receives the React Flow instance once it exists; the shell records it for scripted checks. */
type FlowInitHandler = (instance: unknown) => void;

/** The element React Flow gives a card, which takes focus and selects on Enter. */
const NODE_CLASS_NAME = "react-flow__node";

interface DiagramCanvasProps {
  /** Shown over the canvas while no project is open; the shell passes its welcome screen. */
  emptyState: ReactNode;
  onFlowInit?: FlowInitHandler;
}

/**
 * Infinite canvas hosting the entity-relationship diagram of the open project. What sits over
 * it while there is no project, and who learns about the React Flow instance, come from the
 * shell as props, so the canvas depends on nothing above the features layer.
 */
export function DiagramCanvas({ emptyState, onFlowInit }: DiagramCanvasProps) {
  const hasProject = useProjectStore((state) => state.project !== null);

  return (
    <div className={styles.canvas}>
      <ProjectNotice />
      <FlowCanvas onFlowInit={onFlowInit} />
      {hasProject ? <EmptySchemaNotice /> : emptyState}
      <RelationMarkers />
    </div>
  );
}

/**
 * Neutral note over an empty canvas when the open project holds no table or view, saying why:
 * the database has none, the read was narrowed to none, or the login sees none.
 */
function EmptySchemaNotice() {
  const { t } = useI18n();
  const database = useProjectStore((state) => state.project?.content.snapshot.databaseName ?? "");
  const reason = useProjectStore((state) =>
    state.project === null
      ? null
      : emptySchemaReason(state.project.content.snapshot, state.project.content.inspection),
  );
  if (reason === null) {
    return null;
  }
  return (
    <div className={styles.emptySchema}>
      <EmptyState
        icon={DatabaseZap}
        title={
          reason === "notVisible"
            ? t("sidebar.empty.notVisible.title")
            : t("sidebar.empty.database.title")
        }
        description={t(`sidebar.empty.${reason}.description`, { database })}
      />
    </div>
  );
}

function isDefaultViewport(viewport: Viewport): boolean {
  return viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;
}

/** Views keep their colour in the overview, so it tells them apart as the canvas does. */
function minimapNodeClassName(node: EntityNodeType): string {
  return classNames(node.data.entity.kind === "view" && styles.minimapView);
}

/** Small pill shown while a layout engine runs. */
function LayoutProgress() {
  const { t } = useI18n();
  const isLayoutRunning = useCanvasUiStore((state) => state.isLayoutRunning);
  if (!isLayoutRunning) {
    return null;
  }
  return (
    <div className={styles.layoutProgress} role="status">
      <Spinner size={14} />
      {t("canvas.layout.running")}
    </div>
  );
}

interface FlowCanvasProps {
  onFlowInit?: FlowInitHandler;
}

/**
 * One React Flow instance for the lifetime of the window. Nodes and edges derive from the open
 * project; a document switch restores its viewport or fits the diagram. The selection is the
 * one source of what the Inspector shows: double-click or Enter on a card only open the panel.
 */
function FlowCanvas({ onFlowInit }: FlowCanvasProps) {
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const nodeStates = useProjectStore((state) => state.project?.content.canvas.nodes ?? null);
  const savedDetailLevel = useProjectStore(
    (state) => state.project?.content.canvas.detailLevel ?? "keys",
  );
  const loadToken = useProjectStore((state) => state.project?.loadToken ?? 0);
  const updateCanvas = useProjectStore((state) => state.updateCanvas);
  const isCompactZoom = useCanvasUiStore((state) => state.zoom < COMPACT_ZOOM_THRESHOLD);
  const highlighted = useCanvasUiStore((state) => state.highlightedKeys);
  const focusRequest = useCanvasUiStore((state) => state.focusRequest);
  const fitRequest = useCanvasUiStore((state) => state.fitRequest);
  const setZoom = useCanvasUiStore((state) => state.setZoom);
  const setSelectedKeys = useCanvasUiStore((state) => state.setSelectedKeys);
  const clearHighlights = useCanvasUiStore((state) => state.clearHighlights);
  const openContextMenu = useCanvasUiStore((state) => state.openContextMenu);
  const closeContextMenu = useCanvasUiStore((state) => state.closeContextMenu);
  const openInspector = useCanvasUiStore((state) => state.openInspector);
  const instanceRef = useRef<FlowInstance | null>(null);

  const entities = useMemo(
    () => (snapshot === null ? NO_ENTITIES : describeEntities(snapshot)),
    [snapshot],
  );
  const detailLevel = effectiveDetailLevel(savedDetailLevel, isCompactZoom ? 0 : 1);
  const derivedNodes = useMemo(
    () =>
      nodeStates === null ? [] : buildEntityNodes(entities, nodeStates, detailLevel, highlighted),
    [entities, nodeStates, detailLevel, highlighted],
  );
  const derivedEdges = useMemo(
    () => (snapshot === null ? [] : buildRelationEdges(snapshot, derivedNodes)),
    [snapshot, derivedNodes],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdgeType>([]);

  useEffect(() => {
    setNodes((previous) => {
      const selected = new Set(previous.filter((node) => node.selected).map((node) => node.id));
      return derivedNodes.map((node) =>
        selected.has(node.id) ? { ...node, selected: true } : node,
      );
    });
  }, [derivedNodes, setNodes]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  // A new document: restore its viewport or fit it, and lay out a schema just read from a
  // database. Runs after the nodes of the document reached React Flow.
  useEffect(() => {
    if (loadToken === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      const instance = instanceRef.current;
      const { project } = useProjectStore.getState();
      if (instance === null || project === null) {
        return;
      }
      const { viewport, layout } = project.content.canvas;
      const isFresh =
        project.path === null &&
        project.savedAt === null &&
        !project.isDirty &&
        layout === "manual";
      if (isFresh) {
        void layoutFreshProject();
      } else if (isDefaultViewport(viewport)) {
        void instance.fitView(FIT_VIEW_OPTIONS);
      } else {
        void instance.setViewport(viewport);
        setZoom(viewport.zoom);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadToken, setZoom]);

  useEffect(() => {
    if (fitRequest > 0) {
      void instanceRef.current?.fitView({ ...FIT_VIEW_OPTIONS, duration: 300 });
    }
  }, [fitRequest]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (focusRequest === null || instance?.getNode(focusRequest.key) === undefined) {
      return;
    }
    if (focusRequest.center) {
      void instance.fitView({
        nodes: [{ id: focusRequest.key }],
        duration: 300,
        maxZoom: 1,
        padding: 0.6,
      });
    }
    setNodes((previous) =>
      previous.map((node) => ({ ...node, selected: node.id === focusRequest.key })),
    );
  }, [focusRequest, setNodes]);

  // Closing the Inspector would drop the focus it holds; the inspected card takes it back first.
  useEffect(() => returnFocusFromInspector(), []);

  const handleInit = useCallback(
    (instance: FlowInstance) => {
      instanceRef.current = instance;
      onFlowInit?.(instance);
    },
    [onFlowInit],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<EntityNodeType>>(
    (_event, _node, draggedNodes) => {
      clearHighlights();
      updateCanvas((canvas) =>
        withPositions(canvas, new Map(draggedNodes.map((node) => [node.id, node.position]))),
      );
    },
    [clearHighlights, updateCanvas],
  );

  // The chevron in the card header is the same command as the context menu's collapse.
  const handleNodeClick = useCallback<NodeMouseHandler<EntityNodeType>>((event, node) => {
    if (event.target instanceof Element && event.target.closest("[data-collapse-toggle]")) {
      setCollapsed([node.id], !node.data.isCollapsed);
    }
  }, []);

  // Double-click opens the Inspector on the card React Flow just selected, except on the chevron,
  // whose two clicks collapse and expand. Focus stays on the card.
  const handleNodeDoubleClick = useCallback<NodeMouseHandler<EntityNodeType>>(
    (event) => {
      if (event.target instanceof Element && event.target.closest("[data-collapse-toggle]")) {
        return;
      }
      openInspector();
    },
    [openInspector],
  );

  const handleNodeContextMenu = useCallback<NodeMouseHandler<EntityNodeType>>(
    (event, node) => {
      event.preventDefault();
      openContextMenu({ key: node.id, x: event.clientX, y: event.clientY });
    },
    [openContextMenu],
  );

  // Enter on a focused card opens the Inspector and hands it focus; React Flow has already
  // selected the card. It is handled here, not as a global shortcut, and only when the card
  // itself is focused, so Enter still activates the buttons inside it, the chevron included.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== "Enter" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.target instanceof HTMLElement && event.target.classList.contains(NODE_CLASS_NAME)) {
        event.preventDefault();
        openInspector({ focus: true });
      }
    },
    [openInspector],
  );

  const handlePaneClick = useCallback(() => {
    clearHighlights();
    closeContextMenu();
  }, [clearHighlights, closeContextMenu]);

  const handleSelectionChange = useCallback<
    OnSelectionChangeFunc<EntityNodeType, RelationEdgeType>
  >(
    ({ nodes: selected }) => {
      setSelectedKeys(selected.map((node) => node.id));
    },
    [setSelectedKeys],
  );

  const handleMove = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setZoom(viewport.zoom);
    },
    [setZoom],
  );

  const handleMoveEnd = useCallback<OnMoveEnd>(
    (_event, viewport) => {
      setZoom(viewport.zoom);
      updateCanvas(
        (canvas) =>
          canvas.viewport.x === viewport.x &&
          canvas.viewport.y === viewport.y &&
          canvas.viewport.zoom === viewport.zoom
            ? canvas
            : { ...canvas, viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } },
        { undoable: false, dirty: false },
      );
    },
    [setZoom, updateCanvas],
  );

  return (
    <ReactFlow<EntityNodeType, RelationEdgeType>
      // Focusable by script only: where focus lands when the Inspector hands it back and the
      // inspected card is not rendered.
      className={styles.flow}
      tabIndex={-1}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onInit={handleInit}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      onNodeContextMenu={handleNodeContextMenu}
      onKeyDown={handleKeyDown}
      onPaneClick={handlePaneClick}
      onSelectionChange={handleSelectionChange}
      onMove={handleMove}
      onMoveEnd={handleMoveEnd}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      nodesConnectable={false}
      deleteKeyCode={null}
      selectNodesOnDrag={false}
      onlyRenderVisibleElements
      elevateNodesOnSelect
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
      <Controls showInteractive={false} position="bottom-right" />
      {nodes.length > 0 ? (
        <MiniMap<EntityNodeType>
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={0}
          nodeClassName={minimapNodeClassName}
        />
      ) : null}
      <LayoutProgress />
    </ReactFlow>
  );
}
