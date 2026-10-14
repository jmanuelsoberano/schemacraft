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
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ActionsById } from "@/app/actions/action";
import { EntityNode } from "@/features/canvas/EntityNode";
import { RelationEdge } from "@/features/canvas/RelationEdge";
import { RelationMarkers } from "@/features/canvas/RelationMarkers";
import { layoutFreshProject } from "@/features/canvas/canvasActions";
import { toggleCollapsed, withPositions } from "@/features/canvas/canvasState";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import {
  COMPACT_ZOOM_THRESHOLD,
  describeEntities,
  effectiveDetailLevel,
} from "@/features/canvas/geometry";
import type { EntityDescriptor } from "@/features/canvas/geometry";
import {
  ENTITY_NODE_TYPE,
  RELATION_EDGE_TYPE,
  buildEntityNodes,
  buildRelationEdges,
} from "@/features/canvas/graph";
import type {
  EntityNode as EntityNodeType,
  RelationEdge as RelationEdgeType,
} from "@/features/canvas/graph";
import { exposeFlowInstance } from "@/app/developmentHooks";
import { ProjectNotice } from "@/features/project/ProjectNotice";
import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { Spinner } from "@/shared/ui/Spinner";

import styles from "./DiagramCanvas.module.css";
import { WelcomeOverlay } from "./WelcomeOverlay";

// Stable references keep React Flow from re-initialising on every render.
const NODE_TYPES = { [ENTITY_NODE_TYPE]: EntityNode };
const EDGE_TYPES = { [RELATION_EDGE_TYPE]: RelationEdge };
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;
const NO_ENTITIES: ReadonlyMap<string, EntityDescriptor> = new Map();

type FlowInstance = ReactFlowInstance<EntityNodeType, RelationEdgeType>;

interface DiagramCanvasProps {
  actions: ActionsById;
}

/** Infinite canvas hosting the entity-relationship diagram of the open project. */
export function DiagramCanvas({ actions }: DiagramCanvasProps) {
  const hasProject = useProjectStore((state) => state.project !== null);

  return (
    <div className={styles.canvas}>
      <ProjectNotice />
      <FlowCanvas />
      {hasProject ? null : <WelcomeOverlay actions={actions} />}
      <RelationMarkers />
    </div>
  );
}

function isDefaultViewport(viewport: Viewport): boolean {
  return viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;
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

/**
 * One React Flow instance for the lifetime of the window. Nodes and edges derive from the open
 * project; a document switch restores its viewport or fits the diagram.
 */
function FlowCanvas() {
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
    void instance.fitView({
      nodes: [{ id: focusRequest.key }],
      duration: 300,
      maxZoom: 1,
      padding: 0.6,
    });
    setNodes((previous) =>
      previous.map((node) => ({ ...node, selected: node.id === focusRequest.key })),
    );
  }, [focusRequest, setNodes]);

  const handleInit = useCallback((instance: FlowInstance) => {
    instanceRef.current = instance;
    exposeFlowInstance(instance);
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<EntityNodeType>>(
    (_event, _node, draggedNodes) => {
      clearHighlights();
      updateCanvas((canvas) =>
        withPositions(canvas, new Map(draggedNodes.map((node) => [node.id, node.position]))),
      );
    },
    [clearHighlights, updateCanvas],
  );

  const handleNodeClick = useCallback<NodeMouseHandler<EntityNodeType>>(
    (event, node) => {
      if (event.target instanceof Element && event.target.closest("[data-collapse-toggle]")) {
        updateCanvas((canvas) => toggleCollapsed(canvas, node.id));
      }
    },
    [updateCanvas],
  );

  const handleNodeContextMenu = useCallback<NodeMouseHandler<EntityNodeType>>(
    (event, node) => {
      event.preventDefault();
      openContextMenu({ key: node.id, x: event.clientX, y: event.clientY });
    },
    [openContextMenu],
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
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onInit={handleInit}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={handleNodeClick}
      onNodeContextMenu={handleNodeContextMenu}
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
        <MiniMap position="bottom-left" pannable zoomable nodeStrokeWidth={0} />
      ) : null}
      <LayoutProgress />
    </ReactFlow>
  );
}
