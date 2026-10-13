import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type {
  Edge,
  Node,
  NodeMouseHandler,
  OnMoveEnd,
  OnNodeDrag,
  OnSelectionChangeFunc,
  Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ActionsById } from "@/app/actions/action";
import { EntityNode } from "@/features/canvas/EntityNode";
import { RelationEdge } from "@/features/canvas/RelationEdge";
import { RelationMarkers } from "@/features/canvas/RelationMarkers";
import { toggleCollapsed, withPositions } from "@/features/canvas/canvasState";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import {
  COMPACT_ZOOM_THRESHOLD,
  describeEntities,
  effectiveDetailLevel,
} from "@/features/canvas/geometry";
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
import { ProjectNotice } from "@/features/project/ProjectNotice";
import { useProjectStore } from "@/features/project/projectStore";
import type { OpenProject } from "@/features/project/projectStore";

import styles from "./DiagramCanvas.module.css";
import { WelcomeOverlay } from "./WelcomeOverlay";

// Stable references keep React Flow from re-initialising on every render.
const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];
const NODE_TYPES = { [ENTITY_NODE_TYPE]: EntityNode };
const EDGE_TYPES = { [RELATION_EDGE_TYPE]: RelationEdge };
const FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 };
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2.5;

interface DiagramCanvasProps {
  actions: ActionsById;
}

/** Infinite canvas hosting the entity-relationship diagram of the open project. */
export function DiagramCanvas({ actions }: DiagramCanvasProps) {
  const project = useProjectStore((state) => state.project);

  return (
    <div className={styles.canvas}>
      <ProjectNotice />
      <ReactFlowProvider>
        {project === null ? (
          <EmptyCanvas />
        ) : (
          <ProjectCanvas key={project.loadToken} project={project} />
        )}
      </ReactFlowProvider>
      {project === null ? <WelcomeOverlay actions={actions} /> : null}
      <RelationMarkers />
    </div>
  );
}

function EmptyCanvas() {
  return (
    <ReactFlow
      nodes={NO_NODES}
      edges={NO_EDGES}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      nodesConnectable={false}
      deleteKeyCode={null}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

function isDefaultViewport(viewport: Viewport): boolean {
  return viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;
}

interface ProjectCanvasProps {
  project: OpenProject;
}

/** The diagram of one loaded document; remounted whenever another document is loaded. */
function ProjectCanvas({ project }: ProjectCanvasProps) {
  const { content } = project;
  const updateCanvas = useProjectStore((state) => state.updateCanvas);
  const isCompactZoom = useCanvasUiStore((state) => state.zoom < COMPACT_ZOOM_THRESHOLD);
  const highlighted = useCanvasUiStore((state) => state.highlightedKeys);
  const focusRequest = useCanvasUiStore((state) => state.focusRequest);
  const setZoom = useCanvasUiStore((state) => state.setZoom);
  const setSelectedKeys = useCanvasUiStore((state) => state.setSelectedKeys);
  const clearHighlights = useCanvasUiStore((state) => state.clearHighlights);
  const reactFlow = useReactFlow<EntityNodeType, RelationEdgeType>();
  // The viewport saved with the document is restored once; a fresh document is fitted instead.
  const [initialViewport] = useState(() => content.canvas.viewport);

  const entities = useMemo(() => describeEntities(content.snapshot), [content.snapshot]);
  const detailLevel = effectiveDetailLevel(content.canvas.detailLevel, isCompactZoom ? 0 : 1);
  const nodeStates = content.canvas.nodes;
  const derivedNodes = useMemo(
    () => buildEntityNodes(entities, nodeStates, detailLevel, highlighted),
    [entities, nodeStates, detailLevel, highlighted],
  );
  const derivedEdges = useMemo(
    () => buildRelationEdges(content.snapshot, derivedNodes),
    [content.snapshot, derivedNodes],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNodeType>(derivedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationEdgeType>(derivedEdges);

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

  useEffect(() => {
    if (focusRequest === null || reactFlow.getNode(focusRequest.key) === undefined) {
      return;
    }
    void reactFlow.fitView({
      nodes: [{ id: focusRequest.key }],
      duration: 300,
      maxZoom: 1,
      padding: 0.6,
    });
    setNodes((previous) =>
      previous.map((node) => ({ ...node, selected: node.id === focusRequest.key })),
    );
  }, [focusRequest, reactFlow, setNodes]);

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

  const fitsOnLoad = isDefaultViewport(initialViewport);

  return (
    <ReactFlow<EntityNodeType, RelationEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={handleNodeClick}
      onSelectionChange={handleSelectionChange}
      onMove={handleMove}
      onMoveEnd={handleMoveEnd}
      fitView={fitsOnLoad}
      fitViewOptions={FIT_VIEW_OPTIONS}
      defaultViewport={fitsOnLoad ? undefined : initialViewport}
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
      <MiniMap position="bottom-left" pannable zoomable nodeStrokeWidth={0} />
    </ReactFlow>
  );
}
